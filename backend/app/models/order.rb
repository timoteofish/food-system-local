class Order < ApplicationRecord
  belongs_to :business
  belongs_to :customer, class_name: "User", optional: true
  belongs_to :payment_method, optional: true
  belongs_to :restaurant_table, optional: true
  has_many :order_items, dependent: :destroy
  has_many :products, through: :order_items
  has_many :transactions, dependent: :destroy

  validates :business_id, presence: true
  validates :customer_name, :customer_phone, presence: true
  validates :customer_name, length: { maximum: 120 }
  validates :customer_phone, length: { maximum: 40 }
  validates :customer_email, length: { maximum: 160 }, allow_blank: true
  validates :delivery_address, :notes, length: { maximum: 1_000 }, allow_blank: true
  validates :total_amount, numericality: { greater_than_or_equal_to: 0 }
  validates :order_items, length: { maximum: 50 }

  enum :status, { pending: 0, confirmed: 1, preparing: 2, ready: 3, delivered: 4, cancelled: 5 }
  enum :payment_status, { pending: 0, completed: 1, failed: 2, refunded: 3 }, prefix: true

  before_create :generate_order_number
  before_validation :calculate_total, if: -> { order_items.loaded? && order_items.any? }

  scope :recent, -> { order(created_at: :desc) }
  scope :pending, -> { where(status: :pending) }
  scope :today, -> { where(created_at: Time.zone.today.all_day) }
  scope :by_status, ->(status) { where(status: status) if status.present? }
  scope :by_date, ->(start_date, end_date) { where(created_at: start_date..end_date) if start_date.present? && end_date.present? }

  def confirm!
    update(status: :confirmed, confirmed_at: Time.current)
  end

  def mark_ready!
    update(status: :ready)
  end

  def mark_delivered!
    update(status: :delivered, completed_at: Time.current)
  end

  def cancel!
    update(status: :cancelled)
  end

  def mark_paid!
    update!(payment_status: :completed)
  end

  def add_item(product, quantity, notes = nil)
    order_items.create!(
      product: product,
      quantity: quantity,
      unit_price: product.price,
      total_price: product.price * quantity,
      notes: notes
    )
    calculate_total
    save!
  end

  def recalculate_total!
    calculate_total
    save!
  end

  private

  def generate_order_number
    self.order_number ||= "ORD-#{Time.current.strftime('%Y%m%d')}-#{SecureRandom.hex(3).upcase}"
  end

  def calculate_total
    subtotal_value = order_items.sum { |item| item.total_price.to_f }
    self.subtotal = subtotal_value
    tax_rate = business&.settings&.fetch("tax_rate", 0).to_f
    self.tax_amount = (subtotal_value * tax_rate) / 100.0
    self.total_amount = subtotal_value + tax_amount.to_f - discount_amount.to_f
  end
end
