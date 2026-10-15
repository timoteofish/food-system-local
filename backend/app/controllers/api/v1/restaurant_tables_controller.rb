module Api
  module V1
    class RestaurantTablesController < ApplicationController
      before_action :authenticate_user!, except: [:public_menu]
      before_action :set_business, except: [:public_menu]
      before_action :authorize_business!, except: [:public_menu]
      before_action :set_table, only: [:show, :update, :destroy, :rotate_token]

      def index
        render json: @business.restaurant_tables.ordered.map(&:public_payload), status: :ok
      end

      def show
        render json: @table.public_payload, status: :ok
      end

      def create
        table = @business.restaurant_tables.find_or_initialize_by(name: table_params[:name])
        table.status = table_params[:status] if table_params[:status].present?

        if table.save
          render json: table.public_payload, status: table.previously_new_record? ? :created : :ok
        else
          render json: { error: "Failed to save table", errors: table.errors.messages }, status: :unprocessable_entity
        end
      end

      def update
        if @table.update(table_params)
          render json: @table.public_payload, status: :ok
        else
          render json: { error: "Failed to update table", errors: @table.errors.messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @table.update!(status: :inactive)
        render json: { message: "Table disabled successfully" }, status: :ok
      end

      def rotate_token
        @table.rotate_token!
        render json: @table.public_payload, status: :ok
      end

      def public_menu
        table = RestaurantTable.active.includes(business: [:categories, products: :category]).find_by!(public_token: params[:token])
        table.touch(:last_used_at)

        render json: table.business.menu_data.merge(
          business_id: table.business_id,
          table: {
            id: table.id,
            name: table.name
          }
        ), status: :ok
      end

      private

      def set_business
        @business = Business.find(params[:business_id])
      end

      def set_table
        @table = @business.restaurant_tables.find(params[:id])
      end

      def authorize_business!
        authorize_business_access!(@business, permission: :manage_menu)
      end

      def table_params
        params.require(:restaurant_table).permit(:name, :status)
      end
    end
  end
end
