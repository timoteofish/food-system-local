class CreateOrders < ActiveRecord::Migration[8.1]
  def change
    create_table :orders, id: :uuid do |t|
      t.references :business, type: :uuid, null: false, foreign_key: true
      t.references :customer, type: :uuid, foreign_key: { to_table: :users }
      t.references :payment_method, type: :uuid, foreign_key: true
      t.string :order_number
      t.string :customer_name, null: false
      t.string :customer_phone, null: false
      t.string :customer_email
      t.text :delivery_address
      t.text :notes
      t.integer :status, default: 0, null: false
      t.integer :payment_status, default: 0, null: false
      t.decimal :subtotal, precision: 10, scale: 2, default: 0, null: false
      t.decimal :tax_amount, precision: 10, scale: 2, default: 0, null: false
      t.decimal :discount_amount, precision: 10, scale: 2, default: 0, null: false
      t.decimal :total_amount, precision: 10, scale: 2, default: 0, null: false
      t.datetime :confirmed_at
      t.datetime :completed_at

      t.timestamps
    end

    add_index :orders, [:business_id, :created_at]
    add_index :orders, :order_number, unique: true
  end
end
