class CreateBusinessMemberships < ActiveRecord::Migration[8.1]
  def up
    create_table :business_memberships, id: :uuid do |t|
      t.references :business, type: :uuid, null: false, foreign_key: true
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.integer :role, default: 0, null: false
      t.integer :status, default: 0, null: false

      t.timestamps
    end

    add_index :business_memberships, [:business_id, :user_id], unique: true
    add_index :business_memberships, [:user_id, :status]

    execute <<~SQL.squish
      INSERT INTO business_memberships (id, business_id, user_id, role, status, created_at, updated_at)
      SELECT gen_random_uuid(), businesses.id, businesses.user_id, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM businesses
      ON CONFLICT (business_id, user_id) DO NOTHING
    SQL
  end

  def down
    drop_table :business_memberships
  end
end
