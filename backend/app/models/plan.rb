class Plan < ApplicationRecord
  has_many :subscriptions, dependent: :restrict_with_error

  validates :name, :slug, presence: true
  validates :slug, uniqueness: true
  validates :price, numericality: { greater_than_or_equal_to: 0 }

  scope :active, -> { where(active: true) }
  scope :ordered, -> { order(position: :asc) }

  def as_json(options = {})
    super(options).merge(
      "price_label" => format("R$ %.2f", price).tr(".", ",")
    )
  end
end
