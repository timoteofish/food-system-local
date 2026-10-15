class AddGoogleAuthFieldsToUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users, bulk: true do |t|
      t.string :provider, null: false, default: "email"
      t.string :google_uid
      t.string :full_name
      t.string :avatar_url
      t.boolean :email_verified, null: false, default: false
    end

    add_index :users, :google_uid, unique: true
    add_index :users, :provider
  end
end
