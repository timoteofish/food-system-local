class ApplicationController < ActionController::API
  include ActionController::Cookies

  before_action :set_default_headers
  before_action :enforce_json_request!
  rescue_from ActionController::ParameterMissing, with: :handle_missing_param
  rescue_from ActiveRecord::RecordNotFound, with: :handle_not_found
  rescue_from ActiveRecord::RecordInvalid, with: :handle_validation_error

  protected

  def authenticate_user!
    return authenticate_local_user! if local_mode?

    payload = decoded_token
    return unless payload

    user_id = payload["user_id"]
    return render(json: { error: "Invalid token payload" }, status: :unauthorized) if user_id.blank?

    @current_user = User.find(user_id)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "User not found" }, status: :unauthorized
  end

  def local_mode?
    ActiveModel::Type::Boolean.new.cast(ENV.fetch("FOOD_SYSTEM_LOCAL_MODE", "false"))
  end

  def authenticate_local_user!
    @current_user = User.find_or_create_by!(email: "local@food-system.local") do |user|
      user.full_name = "Administrador"
      user.business_name = "Meu estabelecimento"
      user.password = SecureRandom.hex(32)
      user.password_confirmation = user.password
      user.role = :owner
      user.status = :active
      user.provider = "local"
      user.email_verified = true
    end

    business = @current_user.business || Business.create!(
      user: @current_user,
      name: @current_user.business_name,
      primary_color: "#0f766e",
      theme_style: :clean,
      status: :active,
      settings: { tax_rate: 0, delivery_fee: 0, currency: "BRL" }
    )
    business.business_memberships.find_or_create_by!(user: @current_user) do |membership|
      membership.role = :owner
      membership.status = :active
    end
  end

  def authenticate_business_owner!
    authenticate_user!
    return if performed?
    return if current_user.business_memberships.active.owner.exists? || @current_user.business.present?

    render json: { error: "Not authorized" }, status: :forbidden
  end

  def current_business_for_user
    current_user.business || current_user.businesses.merge(BusinessMembership.active).first
  end

  def business_membership_for(business)
    return BusinessMembership.new(role: :owner, status: :active, business: business, user: current_user) if business.user_id == current_user.id
    return BusinessMembership.new(role: :owner, status: :active, business: business, user: current_user) if current_user.admin?

    current_user.business_memberships.active.find_by(business: business)
  end

  def authorize_business_access!(business, permission: :access)
    membership = business_membership_for(business)
    allowed =
      case permission
      when :manage_business
        membership&.can_manage_business?
      when :manage_menu
        membership&.can_manage_menu?
      when :manage_orders
        membership&.can_manage_orders?
      when :manage_cash
        membership&.can_manage_cash?
      else
        membership.present?
      end

    return true if allowed

    render json: { error: "Not authorized" }, status: :forbidden
    false
  end

  def decoded_token
    header = request.headers["Authorization"].to_s
    bearer_token = header.start_with?("Bearer ") ? header.split(" ").last : nil
    cookie_token = cookies.encrypted[:food_system_session]
    enforce_cookie_csrf! if bearer_token.blank? && cookie_token.present?
    return if performed?

    token = bearer_token.presence || cookie_token
    return render(json: { error: "Missing token" }, status: :unauthorized) if token.blank?

    JWT.decode(token, Rails.application.secrets.jwt_secret_key, true, algorithm: "HS256").first
  rescue JWT::DecodeError => e
    render json: { error: "Invalid token: #{e.message}" }, status: :unauthorized
    nil
  end

  def current_user
    @current_user
  end

  def set_default_headers
    response.headers["Content-Type"] = "application/json"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
  end

  def enforce_json_request!
    return if request.get? || request.head? || request.options?
    return if request.media_type == "application/json"

    render json: { error: "Content-Type must be application/json" }, status: :unsupported_media_type
  end

  def rate_limit!(key:, limit:, period:)
    cache_key = "rate-limit:#{key}"
    count = Rails.cache.read(cache_key).to_i + 1
    Rails.cache.write(cache_key, count, expires_in: period)
    return if count.to_i <= limit

    render json: { error: "Muitas tentativas. Aguarde um pouco e tente novamente." }, status: :too_many_requests
  end

  def issue_session_cookie(token)
    cookies.encrypted[:food_system_session] = {
      value: token,
      httponly: true,
      secure: Rails.env.production?,
      same_site: Rails.env.production? ? :none : :lax,
      expires: 24.hours.from_now
    }
  end

  def clear_session_cookie
    cookies.delete(
      :food_system_session,
      secure: Rails.env.production?,
      same_site: Rails.env.production? ? :none : :lax
    )
  end

  def enforce_cookie_csrf!
    return if request.get? || request.head? || request.options?
    return if request.headers["X-Food-System-Client"].to_s == "web"

    render json: { error: "Missing CSRF protection header" }, status: :forbidden
  end

  def handle_missing_param(exception)
    return if performed?

    render json: { error: "Missing parameter: #{exception.param}" }, status: :bad_request
  end

  def handle_not_found
    return if performed?

    render json: { error: "Resource not found" }, status: :not_found
  end

  def handle_validation_error(exception)
    return if performed?

    render json: {
      error: "Validation failed",
      errors: exception.record.errors.messages
    }, status: :unprocessable_entity
  end

  def user_payload(user)
    return nil unless user

    {
      id: user.id,
      email: user.email,
      name: user.full_name.presence || user.business_name,
      business_name: user.business_name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      provider: user.provider,
      avatar_url: user.avatar_url,
      email_verified: user.email_verified
    }
  end

  def business_payload(business)
    return nil unless business

    {
      id: business.id,
      name: business.name,
      description: business.description,
      logo_url: business.logo_url,
      primary_color: business.primary_color,
      theme_style: business.theme_style,
      address: business.address,
      city: business.city,
      state: business.state,
      zip_code: business.zip_code,
      phone: business.phone,
      email: business.email,
      website: business.website,
      settings: business.settings || {}
    }
  end

  def plan_payload(plan)
    return nil unless plan

    {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      price: plan.price,
      billing_cycle: plan.billing_cycle,
      features: plan.features,
      max_products: plan.max_products,
      max_orders_per_month: plan.max_orders_per_month
    }
  end

  def subscription_payload(subscription)
    return nil unless subscription

    {
      id: subscription.id,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      plan_id: subscription.plan_id
    }
  end

  def subscription_payment_payload(payment)
    return nil unless payment

    {
      id: payment.id,
      amount: payment.amount,
      payment_method: payment.payment_method,
      status: payment.status,
      reference_code: payment.reference_code,
      provider: payment.provider,
      provider_status: payment.provider_status,
      paid_at: payment.paid_at
    }
  end
end
