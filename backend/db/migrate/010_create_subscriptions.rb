class CreateSubscriptions < ActiveRecord::Migration[8.1]
  def change
    create_table :subscriptions, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true, index: { unique: true }
      t.references :plan, type: :uuid, null: false, foreign_key: true
      t.integer :status, default: 0, null: false
      t.datetime :current_period_start
      t.datetime :current_period_end

      t.timestamps
    end
  end
end
