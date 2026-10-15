class CreateBusinesses < ActiveRecord::Migration[8.1]
  def change
    create_table :businesses, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true, index: { unique: true }
      t.string :name, null: false
      t.text :description
      t.string :logo_url
      t.string :primary_color, default: "#0f766e", null: false
      t.integer :theme_style, default: 0, null: false
      t.string :address
      t.string :city
      t.string :state
      t.string :zip_code
      t.string :phone
      t.string :email
      t.string :website
      t.integer :status, default: 0, null: false
      t.jsonb :settings, default: {}, null: false

      t.timestamps
    end
  end
end
