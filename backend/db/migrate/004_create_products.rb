class CreateProducts < ActiveRecord::Migration[8.1]
  def change
    create_table :products, id: :uuid do |t|
      t.references :business, type: :uuid, null: false, foreign_key: true
      t.references :category, type: :uuid, null: false, foreign_key: true
      t.string :name, null: false
      t.text :description
      t.decimal :price, precision: 10, scale: 2, null: false, default: 0
      t.string :image_url
      t.integer :status, default: 0, null: false
      t.integer :position, default: 0, null: false

      t.timestamps
    end

    add_index :products, [:business_id, :status]
  end
end
