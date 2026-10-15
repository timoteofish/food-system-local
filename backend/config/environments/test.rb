Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = true
  config.consider_all_requests_local = true
  config.action_controller.perform_caching = false
  config.cache_store = :null_store
  config.active_support.deprecation = :stderr
  config.active_job.queue_adapter = :test
end
