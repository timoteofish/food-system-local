Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins ENV.fetch(
      "CORS_ORIGINS",
      "http://localhost:4173,http://127.0.0.1:4173"
    ).split(",").map(&:strip)
    resource "*",
      headers: :any,
      methods: %i[get post put patch delete options head],
      expose: %w[Authorization],
      credentials: true
  end
end
