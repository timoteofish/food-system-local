class Category < ApplicationRecord
  belongs_to :business
  has_many :products, dependent: :restrict_with_error

  validates :name, presence: true, uniqueness: { scope: :business_id }
  validates :business_id, presence: true

  enum :status, { active: 0, inactive: 1 }

  scope :active, -> { where(status: :active) }
  scope :ordered, -> { order(position: :asc, name: :asc) }
end
