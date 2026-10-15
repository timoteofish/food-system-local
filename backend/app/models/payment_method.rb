class PaymentMethod < ApplicationRecord
  belongs_to :business
  has_many :orders
  has_many :transactions

  validates :method_type, presence: true
  validates :name, presence: true, uniqueness: { scope: :business_id }
  validates :business_id, presence: true

  enum :status, { active: 0, inactive: 1 }
  enum :method_type, { credit_card: 0, debit_card: 1, pix: 2, money: 3 }

  scope :active, -> { where(status: :active) }
end
