class ChangeBusinessPrimaryColorDefault < ActiveRecord::Migration[8.1]
  def change
    change_column_default :businesses, :primary_color, from: "#2563eb", to: "#0f766e"
  end
end
