require "test_helper"

class SecurityFlowTest < ActionDispatch::IntegrationTest
  setup do
    @owner = User.create!(
      email: "owner@example.com",
      password: "secret123",
      password_confirmation: "secret123",
      business_name: "Owner Food"
    )
    @business = Business.create!(
      user: @owner,
      name: "Owner Food",
      primary_color: "#2563eb",
      settings: {}
    )
    @category = @business.categories.create!(name: "Lanches")
    @product = @business.products.create!(
      category: @category,
      name: "Burger",
      price: 25.0
    )
    @table = @business.restaurant_tables.create!(name: "Mesa 01")
    @business.business_memberships.create!(user: @owner, role: :owner, status: :active)

    @other_owner = User.create!(
      email: "other@example.com",
      password: "secret123",
      password_confirmation: "secret123",
      business_name: "Other Food"
    )
    @other_business = Business.create!(
      user: @other_owner,
      name: "Other Food",
      primary_color: "#2563eb",
      settings: {}
    )
  end

  test "public order starts pending and does not create cash movement" do
    post "/api/v1/businesses/#{@business.id}/orders",
      params: {
        order: {
          customer_name: "Mesa 1",
          customer_phone: "0000000000",
          notes: "Mesa: Mesa 1 | Pagamento: Balcao"
        },
        items: [{ product_id: @product.id, quantity: 2 }]
      },
      as: :json

    assert_response :created
    order = @business.orders.last
    assert_equal "pending", order.status
    assert_equal "pending", order.payment_status
    assert_equal 0, @business.cash_movements.count
  end

  test "public table token exposes menu without business id in url" do
    get "/api/v1/menu/#{@table.public_token}", as: :json

    assert_response :ok
    assert_equal @business.id, response.parsed_body["business_id"]
    assert_equal "Mesa 01", response.parsed_body.dig("table", "name")
    assert_equal @table.public_token, response.parsed_body.dig("table", "public_token")
  end

  test "public order with table token attaches the restaurant table" do
    post "/api/v1/businesses/#{@business.id}/orders",
      params: {
        order: {
          customer_name: "Mesa 1",
          customer_phone: "0000000000",
          notes: "Pagamento: Balcao"
        },
        table_token: @table.public_token,
        items: [{ product_id: @product.id, quantity: 1 }]
      },
      as: :json

    assert_response :created
    order = @business.orders.last
    assert_equal @table.id, order.restaurant_table_id
    assert_equal "Mesa 01", order.delivery_address
  end

  test "cash movement is created once when order is completed" do
    order = @business.orders.create!(
      customer_name: "Mesa 1",
      customer_phone: "0000000000",
      status: :ready,
      payment_status: :pending
    )
    order.add_item(@product, 1)

    patch "/api/v1/businesses/#{@business.id}/orders/#{order.id}/update_status",
      headers: auth_header(@owner),
      params: { status: "delivered" },
      as: :json

    assert_response :ok
    assert_equal "completed", order.reload.payment_status
    assert_equal 1, @business.cash_movements.where(source: "order", reference_id: order.id).count

    patch "/api/v1/businesses/#{@business.id}/orders/#{order.id}/update_status",
      headers: auth_header(@owner),
      params: { status: "delivered" },
      as: :json

    assert_response :ok
    assert_equal 1, @business.cash_movements.where(source: "order", reference_id: order.id).count
  end

  test "owner cannot access another business products" do
    get "/api/v1/businesses/#{@other_business.id}/products",
      headers: auth_header(@owner),
      as: :json

    assert_response :forbidden
  end

  test "kitchen member can access orders but cannot manage menu or cash" do
    kitchen = User.create!(
      email: "kitchen@example.com",
      password: "secret123",
      password_confirmation: "secret123",
      business_name: "Kitchen Staff"
    )
    @business.business_memberships.create!(user: kitchen, role: :kitchen, status: :active)

    get "/api/v1/businesses/#{@business.id}/orders",
      headers: auth_header(kitchen),
      as: :json
    assert_response :ok

    get "/api/v1/businesses/#{@business.id}/products",
      headers: auth_header(kitchen),
      as: :json
    assert_response :forbidden

    get "/api/v1/businesses/#{@business.id}/cash_movements",
      headers: auth_header(kitchen),
      as: :json
    assert_response :forbidden
  end

  test "manager can create team member" do
    manager = User.create!(
      email: "manager@example.com",
      password: "secret123",
      password_confirmation: "secret123",
      business_name: "Manager Staff"
    )
    @business.business_memberships.create!(user: manager, role: :manager, status: :active)

    post "/api/v1/businesses/#{@business.id}/team",
      headers: auth_header(manager),
      params: {
        membership: {
          email: "cashier@example.com",
          full_name: "Cashier Staff",
          role: "cashier"
        }
      },
      as: :json

    assert_response :created
    assert_equal "cashier", response.parsed_body["role"]
    assert_equal "cashier@example.com", response.parsed_body.dig("user", "email")
  end

  test "team member login receives membership business" do
    cashier = User.create!(
      email: "cashier-login@example.com",
      password: "secret123",
      password_confirmation: "secret123",
      business_name: "Cashier Login"
    )
    @business.business_memberships.create!(user: cashier, role: :cashier, status: :active)

    post "/api/v1/auth/login",
      params: { user: { email: cashier.email, password: "secret123" } },
      as: :json

    assert_response :ok
    assert_equal @business.id, response.parsed_body.dig("business", "id")
  end

  test "login issues http only session cookie and profile accepts cookie auth" do
    post "/api/v1/auth/login",
      params: { user: { email: @owner.email, password: "secret123" } },
      as: :json

    assert_response :ok
    assert_match "food_system_session", response.headers["Set-Cookie"]
    assert_match "HttpOnly", response.headers["Set-Cookie"]

    get "/api/v1/auth/profile", as: :json
    assert_response :ok
    assert_equal @owner.id, response.parsed_body.dig("user", "id")
  end

  test "subscription checkout stays pending when simulated checkout is disabled" do
    plan = Plan.create!(name: "Completo", slug: "completo", price: 49.9)

    with_env("ALLOW_SIMULATED_CHECKOUT" => "false") do
      post "/api/v1/subscription/checkout",
        headers: auth_header(@owner),
        params: { checkout: { plan_slug: plan.slug, payment_method: "pix" } },
        as: :json
    end

    assert_response :created
    assert_equal "pending", @owner.subscription.reload.status
    assert_equal "pending", @owner.subscription.subscription_payments.last.status
  end

  test "signed payment webhook activates subscription" do
    plan = Plan.create!(name: "Pro", slug: "pro", price: 99.9)
    subscription = @owner.build_subscription(plan: plan, status: :pending)
    subscription.save!
    payment = subscription.subscription_payments.create!(
      user: @owner,
      amount: plan.price,
      payment_method: :pix,
      provider: "manual",
      status: :pending
    )
    payload = {
      "event" => "payment.paid",
      "provider" => "manual",
      "reference_code" => payment.reference_code,
      "provider_payment_id" => "pay_123",
      "status" => "paid"
    }
    secret = "webhook-secret"
    raw_body = JSON.generate(payload)
    signature = OpenSSL::HMAC.hexdigest("SHA256", secret, raw_body)

    with_env("PAYMENT_WEBHOOK_SECRET" => secret) do
      post "/api/v1/payments/webhooks",
        headers: { "X-Payment-Signature" => signature, "Content-Type" => "application/json" },
        params: raw_body
    end

    assert_response :ok
    assert_equal "paid", payment.reload.status
    assert_equal "active", subscription.reload.status
    assert_equal "pay_123", payment.provider_payment_id
  end

  private

  def auth_header(user)
    { "Authorization" => "Bearer #{user.generate_api_token}" }
  end

  def with_env(values)
    previous = values.each_with_object({}) do |(key, value), memo|
      memo[key] = ENV[key]
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end

    yield
  ensure
    previous.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
  end
end
