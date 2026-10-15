class AddUniqueOrderCashMovementIndex < ActiveRecord::Migration[8.1]
  def change
    add_index :cash_movements,
      [:business_id, :source, :reference_id],
      unique: true,
      where: "source = 'order' AND reference_id IS NOT NULL",
      name: "index_cash_movements_unique_order_reference"
  end
end
