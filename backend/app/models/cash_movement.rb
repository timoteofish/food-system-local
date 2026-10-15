class CashMovement < ApplicationRecord
  belongs_to :business

  enum :movement_type, { entry: 0, exit: 1 }

  validates :label, presence: true
  validates :amount, numericality: { greater_than_or_equal_to: 0 }

  scope :recent, -> { order(created_at: :desc) }

  def as_json(options = {})
    super(options).merge(
      "type" => movement_type,
      "value" => amount.to_f,
      "createdAt" => created_at.iso8601
    )
  end
end
