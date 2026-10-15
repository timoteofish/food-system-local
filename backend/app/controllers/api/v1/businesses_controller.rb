module Api
  module V1
    class BusinessesController < ApplicationController
      before_action :authenticate_user!, except: [:show_public]
      before_action :set_business, only: [:show, :update, :settings]

      def show
        if authorize_business_access!(@business)
          render json: business_payload(@business), status: :ok
        end
      end

      def show_public
        unless legacy_public_menu_enabled?
          return render json: {
            error: "Public menu by business id disabled. Use the table QR token endpoint."
          }, status: :gone
        end

        @business = Business.find(params[:id])
        render json: @business.menu_data, status: :ok
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Business not found" }, status: :not_found
      end

      def update
        authorize_business!

        if @business.update(business_params)
          render json: business_payload(@business), status: :ok
        else
          render json: { error: "Failed to update business", errors: @business.errors.messages }, status: :unprocessable_entity
        end
      end

      def settings
        authorize_business!
        render json: {
          business_id: @business.id,
          settings: @business.settings,
          theme: @business.theme_style,
          color: @business.primary_color
        }, status: :ok
      end

      private

      def set_business
        @business = Business.find(params[:id])
      end

      def authorize_business!
        authorize_business_access!(@business, permission: :manage_business)
      end

      def business_params
        params.require(:business).permit(
          :name, :description, :logo_url, :primary_color, :theme_style,
          :address, :city, :state, :zip_code, :phone, :email, :website,
          settings: {}
        )
      end

      def legacy_public_menu_enabled?
        ActiveModel::Type::Boolean.new.cast(
          ENV.fetch("ALLOW_LEGACY_PUBLIC_MENU_BY_ID", Rails.env.production? ? "false" : "true")
        )
      end
    end
  end
end
