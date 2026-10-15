class AddRestaurantTableToOrders < ActiveRecord::Migration[8.1]
  def change
    add_reference :orders, :restaurant_table, type: :uuid, foreign_key: true
  end
end
