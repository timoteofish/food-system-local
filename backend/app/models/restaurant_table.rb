class RestaurantTable < ApplicationRecord
  belongs_to :business
  has_many :orders, dependent: :nullify

  enum :status, { active: 0, inactive: 1 }

  validates :business_id, presence: true
  validates :name, presence: true, uniqueness: { scope: :business_id }
  validates :public_token, presence: true, uniqueness: true

  before_validation :normalize_name
  before_validation :ensure_public_token

  scope :ordered, -> { order(:name) }

  def rotate_token!
    update!(public_token: self.class.generate_public_token)
  end

  def public_payload
    {
      id: id,
      name: name,
      public_token: public_token,
      status: status,
      qr_path: "/pages/qr-code-final/index.html?mesa_token=#{public_token}"
    }
  end

  def self.generate_public_token
    SecureRandom.urlsafe_base64(32)
  end

  private

  def normalize_name
    self.name = name.to_s.strip.gsub(/\s+/, " ")
  end

  def ensure_public_token
    self.public_token ||= self.class.generate_public_token
  end
end
