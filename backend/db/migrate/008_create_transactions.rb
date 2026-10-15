class CreateTransactions < ActiveRecord::Migration[8.1]
  def change
    create_table :transactions, id: :uuid do |t|
      t.references :order, type: :uuid, null: false, foreign_key: true
      t.references :payment_method, type: :uuid, foreign_key: true
      t.string :provider_tx_id
      t.decimal :amount, precision: 10, scale: 2, null: false, default: 0
      t.integer :status, default: 0, null: false
      t.datetime :processed_at
      t.jsonb :response, default: {}, null: false

      t.timestamps
    end
  end
end
