class CreateRestaurantTables < ActiveRecord::Migration[8.1]
  def change
    create_table :restaurant_tables, id: :uuid do |t|
      t.references :business, type: :uuid, null: false, foreign_key: true
      t.string :name, null: false
      t.string :public_token, null: false
      t.integer :status, default: 0, null: false
      t.datetime :last_used_at

      t.timestamps
    end

    add_index :restaurant_tables, [:business_id, :name], unique: true
    add_index :restaurant_tables, :public_token, unique: true
  end
end
