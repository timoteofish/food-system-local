class CreatePaymentMethods < ActiveRecord::Migration[8.1]
  def change
    create_table :payment_methods, id: :uuid do |t|
      t.references :business, type: :uuid, null: false, foreign_key: true
      t.integer :method_type, null: false, default: 0
      t.string :name, null: false
      t.integer :status, default: 0, null: false
      t.jsonb :config, default: {}, null: false

      t.timestamps
    end

    add_index :payment_methods, [:business_id, :name], unique: true
  end
end
