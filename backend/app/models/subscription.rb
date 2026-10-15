class Subscription < ApplicationRecord
  belongs_to :user
  belongs_to :plan
  has_many :subscription_payments, dependent: :destroy

  enum :status, { pending: 0, active: 1, past_due: 2, cancelled: 3 }

  validates :user_id, uniqueness: true

  def activate!(period_days: 30)
    update!(
      status: :active,
      current_period_start: Time.current,
      current_period_end: period_days.days.from_now
    )
  end
end
