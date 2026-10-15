class CreatePlans < ActiveRecord::Migration[8.1]
  def change
    create_table :plans, id: :uuid do |t|
      t.string :name, null: false
      t.string :slug, null: false
      t.decimal :price, precision: 10, scale: 2, null: false, default: 0
      t.text :description
      t.jsonb :features, default: {}, null: false
      t.integer :position, default: 0, null: false
      t.boolean :active, default: true, null: false

      t.timestamps
    end

    add_index :plans, :slug, unique: true
  end
end
