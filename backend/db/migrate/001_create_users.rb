class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users, id: :uuid do |t|
      t.string :email, null: false
      t.string :password_digest, null: false
      t.string :business_name, null: false
      t.string :phone
      t.integer :status, default: 0, null: false
      t.integer :role, default: 0, null: false
      t.datetime :last_login_at

      t.timestamps
    end

    add_index :users, :email, unique: true
  end
end
