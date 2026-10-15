class CreateOrderItems < ActiveRecord::Migration[8.1]
  def change
    create_table :order_items, id: :uuid do |t|
      t.references :order, type: :uuid, null: false, foreign_key: true
      t.references :product, type: :uuid, null: false, foreign_key: true
      t.integer :quantity, null: false, default: 1
      t.decimal :unit_price, precision: 10, scale: 2, null: false, default: 0
      t.decimal :total_price, precision: 10, scale: 2, null: false, default: 0
      t.text :notes

      t.timestamps
    end
  end
end
