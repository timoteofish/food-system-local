require "net/http"

class FirebaseTokenVerifier
  CERTS_URL = URI("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com")
  ALGORITHM = "RS256"

  class VerificationError < StandardError; end

  def initialize(project_id:)
    @project_id = project_id.to_s
  end

  def verify!(id_token)
    raise VerificationError, "Token Firebase ausente." if id_token.blank?
    raise VerificationError, "FIREBASE_PROJECT_ID nao configurado." if project_id.blank?

    unverified_header = JWT.decode(id_token, nil, false).last
    key_id = unverified_header["kid"].to_s
    raise VerificationError, "Token Firebase sem chave valida." if key_id.blank?

    public_key = certificates.fetch(key_id) do
      raise VerificationError, "Chave publica do Firebase nao encontrada."
    end

    payload, = JWT.decode(id_token, public_key, true, {
      algorithm: ALGORITHM,
      verify_iat: true,
      verify_expiration: true,
      aud: project_id,
      verify_aud: true,
      iss: issuer,
      verify_iss: true
    })

    raise VerificationError, "Token Firebase sem usuario." if payload["sub"].blank?

    payload
  rescue JWT::DecodeError, JWT::ExpiredSignature, JWT::InvalidAudError, JWT::InvalidIssuerError => e
    raise VerificationError, "Token Firebase invalido: #{e.message}"
  end

  private

  attr_reader :project_id

  def issuer
    "https://securetoken.google.com/#{project_id}"
  end

  def certificates
    cached = Rails.cache.read("firebase/public_keys")
    return cached if cached.present?

    response = Net::HTTP.get_response(CERTS_URL)
    raise VerificationError, "Falha ao carregar chaves publicas do Firebase." unless response.is_a?(Net::HTTPSuccess)

    parsed = JSON.parse(response.body).transform_values do |certificate|
      OpenSSL::X509::Certificate.new(certificate).public_key
    end

    Rails.cache.write("firebase/public_keys", parsed, expires_in: cache_ttl(response))
    parsed
  rescue StandardError => e
    raise e if e.is_a?(VerificationError)

    raise VerificationError, "Falha ao preparar chaves publicas do Firebase."
  end

  def cache_ttl(response)
    cache_control = response["cache-control"].to_s
    max_age = cache_control[/max-age=(\d+)/, 1]
    max_age.present? ? max_age.to_i.seconds : 1.hour
  end
end
