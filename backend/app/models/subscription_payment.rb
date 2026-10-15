class SubscriptionPayment < ApplicationRecord
  belongs_to :subscription
  belongs_to :user

  enum :payment_method, { pix: 0, credit_card: 1, debit_card: 2, free: 3 }
  enum :status, { pending: 0, paid: 1, failed: 2, refunded: 3 }

  validates :amount, numericality: { greater_than_or_equal_to: 0 }
  validates :provider, presence: true
  validates :provider_payment_id, uniqueness: { scope: :provider }, allow_blank: true

  before_create :assign_reference_code

  def mark_paid!
    update!(status: :paid, paid_at: Time.current, processed_at: Time.current)
  end

  def mark_failed!
    update!(status: :failed, processed_at: Time.current)
  end

  def mark_refunded!
    update!(status: :refunded, processed_at: Time.current)
  end

  private

  def assign_reference_code
    self.reference_code ||= "SUB-#{Time.current.strftime('%Y%m%d')}-#{SecureRandom.hex(3).upcase}"
  end
end
