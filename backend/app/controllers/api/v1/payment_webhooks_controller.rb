module Api
  module V1
    class PaymentWebhooksController < ApplicationController
      skip_before_action :enforce_json_request!

      def create
        raw_body = request.raw_post.presence || "{}"
        payload = JSON.parse(raw_body)
        payment = PaymentWebhookProcessor.new(
          payload: payload,
          raw_body: raw_body,
          signature: request.headers["X-Payment-Signature"]
        ).process!

        render json: {
          message: "Webhook processed",
          payment: subscription_payment_payload(payment)
        }, status: :ok
      rescue JSON::ParserError
        render json: { error: "Invalid JSON payload" }, status: :bad_request
      rescue PaymentWebhookProcessor::InvalidSignature => e
        render json: { error: e.message }, status: :unauthorized
      rescue PaymentWebhookProcessor::UnsupportedEvent => e
        render json: { error: e.message }, status: :accepted
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Payment not found" }, status: :not_found
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: "Failed to process webhook", details: e.record.errors.full_messages }, status: :unprocessable_entity
      end
    end
  end
end
