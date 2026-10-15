class AddProviderFieldsToSubscriptionPayments < ActiveRecord::Migration[8.1]
  def change
    add_column :subscription_payments, :provider, :string, null: false, default: "manual"
    add_column :subscription_payments, :provider_payment_id, :string
    add_column :subscription_payments, :provider_status, :string
    add_column :subscription_payments, :processed_at, :datetime

    add_index :subscription_payments, [:provider, :provider_payment_id], unique: true, where: "provider_payment_id IS NOT NULL"
  end
end
