class Product < ApplicationRecord
  belongs_to :business
  belongs_to :category
  has_many :order_items, dependent: :restrict_with_error

  validates :name, presence: true
  validates :price, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :business_id, :category_id, presence: true
  validates :image_url, length: { maximum: 2048 }, allow_blank: true

  enum :status, { active: 0, inactive: 1 }

  scope :active, -> { where(status: :active) }
  scope :ordered, -> { order(position: :asc, created_at: :desc) }
  scope :by_category, ->(category_id) { where(category_id: category_id) if category_id.present? }

  def to_menu_json
    {
      id: id,
      name: name,
      description: description,
      price: format("%.2f", price).tr(".", ","),
      category: category.name,
      image: image_url,
      active: active?
    }
  end

  def active?
    status == "active"
  end

  def as_json(options = {})
    super(options).merge(
      "category" => category&.name,
      "active" => active?,
      "image" => image_url
    )
  end
end
