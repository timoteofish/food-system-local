require "active_support/core_ext/integer/time"

Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = true
  config.consider_all_requests_local = false
  config.action_controller.perform_caching = true
  config.cache_store = :memory_store
  config.active_support.report_deprecations = false
  config.active_record.dump_schema_after_migration = false
  config.active_job.queue_adapter = :async
  config.action_mailer.perform_caching = false
  config.force_ssl = true
  config.assume_ssl = ENV.fetch("RAILS_ASSUME_SSL", "true") == "true"
  if ENV["APP_HOSTS"].present?
    config.hosts = ENV.fetch("APP_HOSTS").split(",").map(&:strip).reject(&:blank?)
  end
end
