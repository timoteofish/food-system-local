class OrderItem < ApplicationRecord
  belongs_to :order
  belongs_to :product

  validates :quantity, presence: true, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 99 }
  validates :notes, length: { maximum: 500 }, allow_blank: true
  validates :unit_price, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :total_price, presence: true, numericality: { greater_than_or_equal_to: 0 }

  before_save :calculate_total

  def as_json(options = {})
    super(options).merge(
      "product_name" => product&.name,
      "unit_price" => unit_price.to_f,
      "total_price" => total_price.to_f
    )
  end

  private

  def calculate_total
    self.total_price = unit_price * quantity
  end
end
