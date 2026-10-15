class Transaction < ApplicationRecord
  belongs_to :order
  belongs_to :payment_method, optional: true

  validates :amount, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :order_id, presence: true

  enum :status, { pending: 0, processing: 1, completed: 2, failed: 3 }

  scope :recent, -> { order(created_at: :desc) }
  scope :completed, -> { where(status: :completed) }
end
