class PaymentWebhookProcessor
  class InvalidSignature < StandardError; end
  class UnsupportedEvent < StandardError; end

  SUPPORTED_EVENTS = {
    "payment.paid" => :paid,
    "payment.approved" => :paid,
    "payment.failed" => :failed,
    "payment.refunded" => :refunded
  }.freeze

  def initialize(payload:, signature:, raw_body: nil, secret: ENV["PAYMENT_WEBHOOK_SECRET"])
    @payload = payload
    @signature = signature.to_s
    @raw_body = raw_body.presence || JSON.generate(deep_sort(payload))
    @secret = secret.to_s
  end

  def process!
    verify_signature!

    event = @payload["event"].to_s
    next_status = SUPPORTED_EVENTS[event]
    raise UnsupportedEvent, "Unsupported payment event" unless next_status

    payment = find_payment!

    ActiveRecord::Base.transaction do
      payment.update!(
        provider: provider,
        provider_payment_id: provider_payment_id,
        provider_status: @payload["status"].presence || event,
        metadata: payment.metadata.merge("last_webhook" => @payload),
        processed_at: Time.current
      )

      case next_status
      when :paid
        payment.mark_paid!
        payment.subscription.activate!
      when :failed
        payment.mark_failed!
        payment.subscription.update!(status: :past_due)
      when :refunded
        payment.mark_refunded!
        payment.subscription.update!(status: :cancelled)
      end
    end

    payment
  end

  private

  def verify_signature!
    raise InvalidSignature, "Payment webhook secret is not configured" if @secret.blank?

    expected = OpenSSL::HMAC.hexdigest("SHA256", @secret, @raw_body)
    return if ActiveSupport::SecurityUtils.secure_compare(expected, @signature)

    raise InvalidSignature, "Invalid payment webhook signature"
  end

  def deep_sort(value)
    case value
    when Hash
      value.keys.sort.each_with_object({}) { |key, sorted| sorted[key] = deep_sort(value[key]) }
    when Array
      value.map { |item| deep_sort(item) }
    else
      value
    end
  end

  def find_payment!
    payment = SubscriptionPayment.find_by(reference_code: reference_code)
    payment ||= SubscriptionPayment.find_by(provider: provider, provider_payment_id: provider_payment_id) if provider_payment_id.present?
    payment || raise(ActiveRecord::RecordNotFound, "Payment not found")
  end

  def reference_code
    @payload["reference_code"].to_s
  end

  def provider
    @payload["provider"].presence || "external"
  end

  def provider_payment_id
    @payload["provider_payment_id"].presence || @payload["payment_id"].presence
  end
end
