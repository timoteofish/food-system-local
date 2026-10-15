class CreateCategories < ActiveRecord::Migration[8.1]
  def change
    create_table :categories, id: :uuid do |t|
      t.references :business, type: :uuid, null: false, foreign_key: true
      t.string :name, null: false
      t.text :description
      t.integer :position, default: 0, null: false
      t.integer :status, default: 0, null: false

      t.timestamps
    end

    add_index :categories, [:business_id, :name], unique: true
  end
end
