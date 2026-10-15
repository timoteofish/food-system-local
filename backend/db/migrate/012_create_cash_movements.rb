class CreateCashMovements < ActiveRecord::Migration[8.1]
  def change
    create_table :cash_movements, id: :uuid do |t|
      t.references :business, type: :uuid, null: false, foreign_key: true
      t.integer :movement_type, null: false, default: 0
      t.string :label, null: false
      t.decimal :amount, precision: 10, scale: 2, null: false, default: 0
      t.string :source, default: "manual", null: false
      t.uuid :reference_id

      t.timestamps
    end

    add_index :cash_movements, [:business_id, :created_at]
  end
end
