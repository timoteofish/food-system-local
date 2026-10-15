module Api
  module V1
    class SubscriptionsController < ApplicationController
      before_action :authenticate_user!

      def show
        subscription = current_user.subscription
        return render json: { subscription: nil, plan: nil }, status: :ok unless subscription

        render json: {
          subscription: subscription_payload(subscription),
          plan: plan_payload(subscription.plan)
        }, status: :ok
      end

      def checkout
        plan = Plan.active.find_by!(slug: checkout_params[:plan_slug])
        payment_method = checkout_params[:payment_method]
        unless SubscriptionPayment.payment_methods.key?(payment_method.to_s)
          return render json: { error: "Método de pagamento inválido." }, status: :bad_request
        end

        subscription = current_user.subscription || current_user.build_subscription(plan: plan, status: :pending)
        subscription.plan = plan
        subscription.save!

        payment = subscription.subscription_payments.create!(
          user: current_user,
          amount: plan.price,
          payment_method: payment_method,
          status: :pending,
          provider: payment_provider,
          provider_payment_id: provider_payment_id,
          provider_status: "created",
          metadata: checkout_params[:metadata] || {}
        )

        if simulated_checkout_enabled?
          payment.mark_paid!
          subscription.activate!
        end

        render json: {
          message: simulated_checkout_enabled? ? "Assinatura ativada com sucesso." : "Pagamento registrado e aguardando confirmação.",
          subscription: subscription_payload(subscription),
          plan: plan_payload(plan),
          payment: subscription_payment_payload(payment),
          payment_reference: payment.reference_code
        }, status: :created
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Plano não encontrado." }, status: :not_found
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: "Falha ao ativar a assinatura.", details: e.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

      def checkout_params
        params.require(:checkout).permit(:plan_slug, :payment_method, metadata: {})
      end

      def simulated_checkout_enabled?
        ActiveModel::Type::Boolean.new.cast(ENV.fetch("ALLOW_SIMULATED_CHECKOUT", Rails.env.development? ? "true" : "false"))
      end

      def payment_provider
        ENV.fetch("PAYMENT_PROVIDER", "manual")
      end

      def provider_payment_id
        metadata = checkout_params[:metadata] || {}
        metadata[:provider_payment_id].presence || metadata["provider_payment_id"].presence
      end
    end
  end
end
