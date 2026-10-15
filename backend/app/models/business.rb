class Business < ApplicationRecord
  belongs_to :user
  has_many :products, dependent: :destroy
  has_many :orders, dependent: :destroy
  has_many :categories, dependent: :destroy
  has_many :payment_methods, dependent: :destroy
  has_many :cash_movements, dependent: :destroy
  has_many :restaurant_tables, dependent: :destroy
  has_many :business_memberships, dependent: :destroy
  has_many :team_members, through: :business_memberships, source: :user

  validates :name, presence: true
  validates :user_id, presence: true, uniqueness: true
  validates :primary_color, format: { with: /\A#[0-9a-fA-F]{6}\z/ }

  enum :status, { active: 0, inactive: 1 }, prefix: true
  enum :theme_style, { clean: 0, compact: 1, premium: 2 }, prefix: true

  store_accessor :settings, :tax_rate, :delivery_fee, :currency

  scope :active, -> { where(status: :active) }

  def menu_data
    {
      business_name: name,
      menu_name: description.presence || name,
      primary_color: primary_color,
      style: theme_style,
      gradient_start: settings&.dig("gradient_start"),
      gradient_end: settings&.dig("gradient_end"),
      gradient_angle: settings&.dig("gradient_angle"),
      menu_banner: settings&.dig("menu_banner"),
      show_all_products: settings&.dig("show_all_products"),
      selected_categories: settings&.dig("selected_categories") || [],
      categories: categories.active.ordered.map { |category| { id: category.id, name: category.name } },
      products: products.active.ordered.map(&:to_menu_json)
    }
  end

  def as_json(options = {})
    super(options).merge(
      "settings" => (settings || {})
    )
  end
end
