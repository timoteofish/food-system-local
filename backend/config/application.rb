require_relative "boot"

require "rails"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_mailer/railtie"
require "action_dispatch/middleware/cookies"

Bundler.require(*Rails.groups)

module FoodSystemBackend
  class Application < Rails::Application
    config.load_defaults 8.1
    config.api_only = true
    config.middleware.use ActionDispatch::Cookies
    config.time_zone = "America/Sao_Paulo"
    config.autoload_lib(ignore: %w[assets tasks])

    config.before_configuration do
      next unless Rails.env.test?
      next if ENV["TEST_DATABASE_URL"].present?

      raise "TEST_DATABASE_URL is required for tests. Use a remote test database separate from DATABASE_URL."
    end

    config.generators do |g|
      g.orm :active_record, primary_key_type: :uuid
    end
  end
end
