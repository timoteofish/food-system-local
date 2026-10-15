class User < ApplicationRecord
  has_secure_password

  has_one :business, dependent: :destroy
  has_many :business_memberships, dependent: :destroy
  has_many :businesses, through: :business_memberships
  has_one :subscription, dependent: :destroy
  has_many :orders, foreign_key: :customer_id, dependent: :nullify
  has_many :subscription_payments, dependent: :destroy

  validates :email, presence: true, uniqueness: { case_sensitive: false },
                    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :google_uid, uniqueness: true, allow_blank: true
  validates :password, length: { minimum: 6 }, if: -> { password.present? }
  validates :business_name, presence: true

  enum :role, { owner: 0, admin: 1, employee: 2 }
  enum :status, { active: 0, inactive: 1, suspended: 2 }

  before_save { self.email = email.to_s.downcase.strip }

  def google_account?
    provider == "google" && google_uid.present?
  end

  def generate_jwt_token
    JWT.encode(
      { user_id: id, exp: 24.hours.from_now.to_i },
      Rails.application.secrets.jwt_secret_key,
      "HS256"
    )
  end

  def generate_api_token
    generate_jwt_token
  end

  def as_json(options = {})
    super(options.merge(except: %i[password_digest])).merge(
      "name" => full_name.presence || business_name,
      "provider" => provider,
      "avatar_url" => avatar_url
    )
  end
end
