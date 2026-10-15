module Api
  module V1
    class CashMovementsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_business
      before_action :authorize_business!

      def index
        movements = @business.cash_movements.recent
        summary = {
          entries_total: movements.entry.sum(:amount),
          exits_total: movements.exit.sum(:amount)
        }
        summary[:balance] = summary[:entries_total] - summary[:exits_total]

        render json: {
          movements: movements.map { |movement| serialize_movement(movement) },
          summary: summary
        }, status: :ok
      end

      def create
        movement = @business.cash_movements.build(movement_params)

        if movement.save
          render json: serialize_movement(movement), status: :created
        else
          render json: { error: "Falha ao registrar movimento.", errors: movement.errors.messages }, status: :unprocessable_entity
        end
      end

      private

      def set_business
        @business = Business.find(params[:business_id])
      end

      def authorize_business!
        authorize_business_access!(@business, permission: :manage_cash)
      end

      def movement_params
        permitted = params.require(:cash_movement).permit(:movement_type, :type, :label, :amount, :value)
        {
          movement_type: permitted[:movement_type] || permitted[:type] || "entry",
          label: permitted[:label],
          amount: normalize_amount(permitted[:amount] || permitted[:value]),
          source: "manual",
          reference_id: nil
        }
      end

      def normalize_amount(value)
        return value.to_f if value.is_a?(Numeric)

        value.to_s.gsub(/[^\d,.-]/, "").tr(".", "").tr(",", ".").to_f
      end

      def serialize_movement(movement)
        {
          id: movement.id,
          movement_type: movement.movement_type,
          type: movement.movement_type,
          label: movement.label,
          amount: movement.amount,
          value: movement.amount.to_f,
          source: movement.source,
          reference_id: movement.reference_id,
          createdAt: movement.created_at.iso8601
        }
      end
    end
  end
end
