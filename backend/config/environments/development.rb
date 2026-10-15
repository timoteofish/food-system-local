require "active_support/core_ext/integer/time"

Rails.application.configure do
  # A edição local não exige autenticação para operar no computador da empresa.
  ENV["FOOD_SYSTEM_LOCAL_MODE"] ||= "true"

  config.enable_reloading = true
  config.eager_load = false
  config.consider_all_requests_local = true
  config.server_timing = true
  config.action_controller.perform_caching = false
  config.cache_store = :memory_store
  config.active_support.deprecation = :log
  config.active_record.migration_error = :page_load
  config.active_record.verbose_query_logs = true
  config.active_job.queue_adapter = :async
  config.action_mailer.raise_delivery_errors = false
  config.action_mailer.perform_caching = false
  config.hosts.clear
end
