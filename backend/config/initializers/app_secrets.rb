Rails.application.class.module_eval do
  def secrets
    jwt_secret_key = ENV["JWT_SECRET_KEY"]
    secret_key_base = ENV["SECRET_KEY_BASE"]
    payment_webhook_secret = ENV["PAYMENT_WEBHOOK_SECRET"]
    simulated_checkout_enabled = ActiveModel::Type::Boolean.new.cast(ENV.fetch("ALLOW_SIMULATED_CHECKOUT", "false"))

    if Rails.env.production? && (jwt_secret_key.blank? || secret_key_base.blank?)
      raise "JWT_SECRET_KEY and SECRET_KEY_BASE must be configured in production."
    end

    if Rails.env.production? && payment_webhook_secret.blank? && !simulated_checkout_enabled
      raise "PAYMENT_WEBHOOK_SECRET must be configured in production when checkout simulation is disabled."
    end

    @food_system_secrets ||= ActiveSupport::InheritableOptions.new(
      jwt_secret_key: jwt_secret_key.presence || "dev_secret_key_change_in_production",
      secret_key_base: secret_key_base.presence || "dev_secret_key_base_change_in_production"
    )
  end
end
