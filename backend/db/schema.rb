# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 19) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pgcrypto"
  enable_extension "plpgsql"

  create_table "businesses", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "address"
    t.string "city"
    t.datetime "created_at", null: false
    t.text "description"
    t.string "email"
    t.string "logo_url"
    t.string "name", null: false
    t.string "phone"
    t.string "primary_color", default: "#0f766e", null: false
    t.jsonb "settings", default: {}, null: false
    t.string "state"
    t.integer "status", default: 0, null: false
    t.integer "theme_style", default: 0, null: false
    t.datetime "updated_at", null: false
    t.uuid "user_id", null: false
    t.string "website"
    t.string "zip_code"
    t.index ["user_id"], name: "index_businesses_on_user_id", unique: true
  end

  create_table "cash_movements", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.decimal "amount", precision: 10, scale: 2, default: "0.0", null: false
    t.uuid "business_id", null: false
    t.datetime "created_at", null: false
    t.string "label", null: false
    t.integer "movement_type", default: 0, null: false
    t.uuid "reference_id"
    t.string "source", default: "manual", null: false
    t.datetime "updated_at", null: false
    t.index ["business_id", "created_at"], name: "index_cash_movements_on_business_id_and_created_at"
    t.index ["business_id", "source", "reference_id"], name: "index_cash_movements_unique_order_reference", unique: true, where: "(((source)::text = 'order'::text) AND (reference_id IS NOT NULL))"
    t.index ["business_id"], name: "index_cash_movements_on_business_id"
  end

  create_table "categories", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "business_id", null: false
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["business_id", "name"], name: "index_categories_on_business_id_and_name", unique: true
    t.index ["business_id"], name: "index_categories_on_business_id"
  end

  create_table "order_items", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "notes"
    t.uuid "order_id", null: false
    t.uuid "product_id", null: false
    t.integer "quantity", default: 1, null: false
    t.decimal "total_price", precision: 10, scale: 2, default: "0.0", null: false
    t.decimal "unit_price", precision: 10, scale: 2, default: "0.0", null: false
    t.datetime "updated_at", null: false
    t.index ["order_id"], name: "index_order_items_on_order_id"
    t.index ["product_id"], name: "index_order_items_on_product_id"
  end

  create_table "orders", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "business_id", null: false
    t.datetime "completed_at"
    t.datetime "confirmed_at"
    t.datetime "created_at", null: false
    t.string "customer_email"
    t.uuid "customer_id"
    t.string "customer_name", null: false
    t.string "customer_phone", null: false
    t.text "delivery_address"
    t.decimal "discount_amount", precision: 10, scale: 2, default: "0.0", null: false
    t.text "notes"
    t.string "order_number"
    t.uuid "payment_method_id"
    t.uuid "restaurant_table_id"
    t.integer "payment_status", default: 0, null: false
    t.integer "status", default: 0, null: false
    t.decimal "subtotal", precision: 10, scale: 2, default: "0.0", null: false
    t.decimal "tax_amount", precision: 10, scale: 2, default: "0.0", null: false
    t.decimal "total_amount", precision: 10, scale: 2, default: "0.0", null: false
    t.datetime "updated_at", null: false
    t.index ["business_id", "created_at"], name: "index_orders_on_business_id_and_created_at"
    t.index ["business_id"], name: "index_orders_on_business_id"
    t.index ["customer_id"], name: "index_orders_on_customer_id"
    t.index ["order_number"], name: "index_orders_on_order_number", unique: true
    t.index ["payment_method_id"], name: "index_orders_on_payment_method_id"
    t.index ["restaurant_table_id"], name: "index_orders_on_restaurant_table_id"
  end

  create_table "business_memberships", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "business_id", null: false
    t.datetime "created_at", null: false
    t.integer "role", default: 0, null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.uuid "user_id", null: false
    t.index ["business_id", "user_id"], name: "index_business_memberships_on_business_id_and_user_id", unique: true
    t.index ["business_id"], name: "index_business_memberships_on_business_id"
    t.index ["user_id", "status"], name: "index_business_memberships_on_user_id_and_status"
    t.index ["user_id"], name: "index_business_memberships_on_user_id"
  end

  create_table "payment_methods", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "business_id", null: false
    t.jsonb "config", default: {}, null: false
    t.datetime "created_at", null: false
    t.integer "method_type", default: 0, null: false
    t.string "name", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["business_id", "name"], name: "index_payment_methods_on_business_id_and_name", unique: true
    t.index ["business_id"], name: "index_payment_methods_on_business_id"
  end

  create_table "plans", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.text "description"
    t.jsonb "features", default: {}, null: false
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.decimal "price", precision: 10, scale: 2, default: "0.0", null: false
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_plans_on_slug", unique: true
  end

  create_table "products", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "business_id", null: false
    t.uuid "category_id", null: false
    t.datetime "created_at", null: false
    t.text "description"
    t.string "image_url"
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.decimal "price", precision: 10, scale: 2, default: "0.0", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["business_id", "status"], name: "index_products_on_business_id_and_status"
    t.index ["business_id"], name: "index_products_on_business_id"
    t.index ["category_id"], name: "index_products_on_category_id"
  end

  create_table "restaurant_tables", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "business_id", null: false
    t.datetime "created_at", null: false
    t.datetime "last_used_at"
    t.string "name", null: false
    t.string "public_token", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["business_id", "name"], name: "index_restaurant_tables_on_business_id_and_name", unique: true
    t.index ["business_id"], name: "index_restaurant_tables_on_business_id"
    t.index ["public_token"], name: "index_restaurant_tables_on_public_token", unique: true
  end

  create_table "subscription_payments", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.decimal "amount", precision: 10, scale: 2, default: "0.0", null: false
    t.datetime "created_at", null: false
    t.jsonb "metadata", default: {}, null: false
    t.datetime "paid_at"
    t.integer "payment_method", default: 0, null: false
    t.datetime "processed_at"
    t.string "provider", default: "manual", null: false
    t.string "provider_payment_id"
    t.string "provider_status"
    t.string "reference_code"
    t.integer "status", default: 0, null: false
    t.uuid "subscription_id", null: false
    t.datetime "updated_at", null: false
    t.uuid "user_id", null: false
    t.index ["provider", "provider_payment_id"], name: "index_subscription_payments_on_provider_and_provider_payment_id", unique: true, where: "(provider_payment_id IS NOT NULL)"
    t.index ["reference_code"], name: "index_subscription_payments_on_reference_code", unique: true
    t.index ["subscription_id"], name: "index_subscription_payments_on_subscription_id"
    t.index ["user_id"], name: "index_subscription_payments_on_user_id"
  end

  create_table "subscriptions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "current_period_end"
    t.datetime "current_period_start"
    t.uuid "plan_id", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.uuid "user_id", null: false
    t.index ["plan_id"], name: "index_subscriptions_on_plan_id"
    t.index ["user_id"], name: "index_subscriptions_on_user_id", unique: true
  end

  create_table "transactions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.decimal "amount", precision: 10, scale: 2, default: "0.0", null: false
    t.datetime "created_at", null: false
    t.uuid "order_id", null: false
    t.uuid "payment_method_id"
    t.datetime "processed_at"
    t.string "provider_tx_id"
    t.jsonb "response", default: {}, null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["order_id"], name: "index_transactions_on_order_id"
    t.index ["payment_method_id"], name: "index_transactions_on_payment_method_id"
  end

  create_table "users", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "avatar_url"
    t.string "business_name", null: false
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.boolean "email_verified", default: false, null: false
    t.string "full_name"
    t.string "google_uid"
    t.datetime "last_login_at"
    t.string "password_digest", null: false
    t.string "phone"
    t.string "provider", default: "email", null: false
    t.integer "role", default: 0, null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["google_uid"], name: "index_users_on_google_uid", unique: true
    t.index ["provider"], name: "index_users_on_provider"
  end

  add_foreign_key "businesses", "users"
  add_foreign_key "business_memberships", "businesses"
  add_foreign_key "business_memberships", "users"
  add_foreign_key "cash_movements", "businesses"
  add_foreign_key "categories", "businesses"
  add_foreign_key "order_items", "orders"
  add_foreign_key "order_items", "products"
  add_foreign_key "orders", "businesses"
  add_foreign_key "orders", "payment_methods"
  add_foreign_key "orders", "restaurant_tables"
  add_foreign_key "orders", "users", column: "customer_id"
  add_foreign_key "payment_methods", "businesses"
  add_foreign_key "products", "businesses"
  add_foreign_key "products", "categories"
  add_foreign_key "restaurant_tables", "businesses"
  add_foreign_key "subscription_payments", "subscriptions"
  add_foreign_key "subscription_payments", "users"
  add_foreign_key "subscriptions", "plans"
  add_foreign_key "subscriptions", "users"
  add_foreign_key "transactions", "orders"
  add_foreign_key "transactions", "payment_methods"
end
