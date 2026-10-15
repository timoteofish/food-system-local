module Api
  module V1
    class OrdersController < ApplicationController
      before_action :set_business
      before_action :limit_public_orders!, only: [:create]
      before_action :authenticate_user!, except: [:create]
      before_action :authorize_business!, except: [:create]
      before_action :set_order, only: [:show, :update_status, :confirm, :mark_ready, :cancel]

      def create
        @order = @business.orders.build(order_params)
        attach_public_table(@order)
        @order.status = :pending
        @order.payment_status = :pending

        ActiveRecord::Base.transaction do
          @order.save!
          add_order_items(@order, order_items_params)
          @order.recalculate_total!
          assign_payment_method(@order, params[:payment_method])
        end

        render json: {
          message: "Order created successfully",
          order: serialize_order(@order),
          order_number: @order.order_number
        }, status: :created
      rescue ActionController::ParameterMissing => e
        render json: { error: "Invalid order payload", details: e.message }, status: :bad_request
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotFound => e
        render json: { error: "Failed to create order", details: e.message }, status: :unprocessable_entity
      end

      def index
        @orders = @business.orders.recent.includes(:order_items)
        @orders = @orders.by_status(params[:status]) if params[:status].present?
        render json: @orders.map { |order| serialize_order(order) }, status: :ok
      end

      def show
        render json: {
          order: serialize_order(@order)
        }, status: :ok
      end

      def update_status
        unless Order.statuses.key?(params[:status].to_s)
          return render json: { error: "Invalid order status" }, status: :bad_request
        end

        if update_order_status!(params[:status])
          render json: serialize_order(@order), status: :ok
        else
          render json: { error: "Failed to update order", errors: @order.errors.messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: "Failed to update order", details: e.message }, status: :unprocessable_entity
      end

      def confirm
        update_order_status!(:confirmed)
        render json: { message: "Order confirmed", order: serialize_order(@order) }, status: :ok
      end

      def mark_ready
        update_order_status!(:ready)
        render json: { message: "Order ready", order: serialize_order(@order) }, status: :ok
      end

      def cancel
        update_order_status!(:cancelled)
        render json: { message: "Order cancelled", order: serialize_order(@order) }, status: :ok
      end

      def today_stats
        today_orders = @business.orders.today
        cash = @business.cash_movements.where(created_at: Time.zone.today.all_day)
        entries = cash.entry.sum(:amount)
        exits = cash.exit.sum(:amount)

        render json: {
          total_orders: today_orders.count,
          total_revenue: today_orders.sum(:total_amount),
          completed: today_orders.where(status: :delivered).count,
          pending: today_orders.where(status: [:pending, :confirmed, :preparing, :ready]).count,
          cash_balance: entries - exits,
          entries_total: entries,
          exits_total: exits,
          orders: today_orders.recent.map { |order| serialize_order(order) }
        }, status: :ok
      end

      private

      def limit_public_orders!
        rate_limit!(key: "orders:#{@business.id}:#{request.remote_ip}", limit: 20, period: 10.minutes)
      end

      def set_business
        @business = Business.find(params[:business_id])
      end

      def set_order
        @order = @business.orders.find(params[:id])
      end

      def authorize_business!
        authorize_business_access!(@business, permission: :manage_orders)
      end

      def order_params
        params.require(:order).permit(:customer_name, :customer_phone, :customer_email, :delivery_address, :notes)
      end

      def attach_public_table(order)
        token = params[:table_token].presence || params.dig(:order, :table_token).presence
        return if token.blank?

        table = @business.restaurant_tables.active.find_by!(public_token: token)
        order.restaurant_table = table
        order.delivery_address = table.name
        table.touch(:last_used_at)
      end

      def order_items_params
        items = Array(params[:items])
        raise ActionController::ParameterMissing, :items if items.blank?
        raise ActiveRecord::RecordInvalid.new(@business.orders.build) if items.size > 50

        items.map do |item|
          {
            product_id: item[:product_id],
            quantity: item[:quantity],
            notes: item[:notes]
          }
        end
      end

      def add_order_items(order, items_params)
        items_params.each do |item|
          product = @business.products.find(item[:product_id])
          quantity = item[:quantity].to_i
          raise ActiveRecord::RecordInvalid.new(order) if quantity <= 0 || quantity > 99

          order.add_item(product, quantity, item[:notes])
        end
      end

      def assign_payment_method(order, provided_method = nil)
        payment_name = provided_method.presence || extract_payment_method(order.notes)
        payment_method = find_or_create_payment_method(payment_name)

        order.update!(payment_method: payment_method) if payment_method.present?
      end

      def register_cash_entry_once(order)
        @business.cash_movements.find_or_create_by!(source: "order", reference_id: order.id) do |movement|
          movement.movement_type = :entry
          movement.label = "Pedido #{order.order_number}"
          movement.amount = order.total_amount
        end
      rescue ActiveRecord::RecordNotUnique
        @business.cash_movements.find_by!(source: "order", reference_id: order.id)
      end

      def update_order_status!(status)
        ActiveRecord::Base.transaction do
          @order.update!(status: status)
          @order.mark_paid! if @order.delivered? && @order.payment_status_pending?
          register_cash_entry_once(@order) if @order.delivered? && @order.payment_status_completed?
        end
      end

      def extract_payment_method(notes)
        match = notes.to_s.match(/Pagamento:\s*([^|]+)/i)
        match ? match[1].strip : "Balcao"
      end

      def find_or_create_payment_method(name)
        normalized = name.to_s.strip
        return nil if normalized.blank?

        mapped_type =
          case normalized.downcase
          when /pix/
            :pix
          when /deb/
            :debit_card
          when /din|cash|balcao/
            :money
          else
            :credit_card
          end

        @business.payment_methods.find_or_create_by!(name: normalized) do |payment_method|
          payment_method.method_type = mapped_type
          payment_method.status = :active
        end
      end

      def serialize_order(order)
        order.as_json.merge(
          "order_items" => order.order_items.map(&:as_json),
          "restaurant_table_name" => order.restaurant_table&.name
        )
      end
    end
  end
end
