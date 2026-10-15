class CreateSubscriptionPayments < ActiveRecord::Migration[8.1]
  def change
    create_table :subscription_payments, id: :uuid do |t|
      t.references :subscription, type: :uuid, null: false, foreign_key: true
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.decimal :amount, precision: 10, scale: 2, null: false, default: 0
      t.integer :payment_method, null: false, default: 0
      t.integer :status, default: 0, null: false
      t.string :reference_code
      t.datetime :paid_at
      t.jsonb :metadata, default: {}, null: false

      t.timestamps
    end

    add_index :subscription_payments, :reference_code, unique: true
  end
end
