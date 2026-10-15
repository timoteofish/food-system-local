class BusinessMembership < ApplicationRecord
  belongs_to :business
  belongs_to :user

  enum :role, { owner: 0, manager: 1, cashier: 2, kitchen: 3, viewer: 4 }
  enum :status, { active: 0, inactive: 1, invited: 2 }

  validates :business_id, uniqueness: { scope: :user_id }
  validates :role, :status, presence: true

  scope :active, -> { where(status: :active) }

  def can_manage_business?
    owner? || manager?
  end

  def can_manage_menu?
    owner? || manager?
  end

  def can_manage_orders?
    owner? || manager? || cashier? || kitchen?
  end

  def can_manage_cash?
    owner? || manager? || cashier?
  end
end
