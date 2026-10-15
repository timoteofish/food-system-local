module Api
  module V1
    class PaymentMethodsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_business
      before_action :authorize_business!
      before_action :set_payment_method, only: [:update, :destroy]

      def index
        render json: @business.payment_methods.order(:created_at).map { |item| serialize_payment_method(item) }, status: :ok
      end

      def create
        payment_method = @business.payment_methods.build(payment_method_params)

        if payment_method.save
          render json: serialize_payment_method(payment_method), status: :created
        else
          render json: { error: "Failed to create payment method", errors: payment_method.errors.messages }, status: :unprocessable_entity
        end
      end

      def update
        if @payment_method.update(payment_method_params)
          render json: serialize_payment_method(@payment_method), status: :ok
        else
          render json: { error: "Failed to update payment method", errors: @payment_method.errors.messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @payment_method.destroy
        render json: { message: "Payment method deleted successfully" }, status: :ok
      end

      private

      def set_business
        @business = Business.find(params[:business_id])
      end

      def set_payment_method
        @payment_method = @business.payment_methods.find(params[:id])
      end

      def authorize_business!
        authorize_business_access!(@business, permission: :manage_business)
      end

      def payment_method_params
        permitted = params.require(:payment_method).permit(:name, :method_type, :status)
        if params[:payment_method].key?(:active)
          permitted[:status] = ActiveModel::Type::Boolean.new.cast(params.dig(:payment_method, :active)) ? :active : :inactive
        end
        permitted
      end

      def serialize_payment_method(payment_method)
        {
          id: payment_method.id,
          name: payment_method.name,
          method_type: payment_method.method_type,
          status: payment_method.status,
          active: payment_method.active?
        }
      end
    end
  end
end
