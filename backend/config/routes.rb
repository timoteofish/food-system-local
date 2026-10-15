Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      post "auth/register", to: "auth#register"
      post "auth/login", to: "auth#login"
      post "auth/firebase", to: "auth#firebase"
      get "auth/firebase/config", to: "auth#firebase_config"
      post "auth/refresh", to: "auth#refresh"
      post "auth/logout", to: "auth#logout"
      get "auth/profile", to: "auth#profile"

      get "plans", to: "plans#index"

      get "subscription", to: "subscriptions#show"
      post "subscription/checkout", to: "subscriptions#checkout"
      post "payments/webhooks", to: "payment_webhooks#create"

      get "businesses/:id", to: "businesses#show"
      get "businesses/:id/public", to: "businesses#show_public"
      get "businesses/:id/menu", to: "businesses#show_public"
      get "menu/:token", to: "restaurant_tables#public_menu"
      patch "businesses/:id", to: "businesses#update"
      get "businesses/:id/settings", to: "businesses#settings"

      resources :businesses, only: [] do
        resources :categories, only: [:index, :create, :update, :destroy]

        get "products/public", to: "products#index_public", on: :member
        resources :products, only: [:index, :show, :create, :update, :destroy]

        resources :orders, only: [:index, :show, :create] do
          member do
            patch :update_status
            post :confirm
            post :mark_ready
            post :cancel
          end

          collection do
            get :today_stats
          end
        end

        resources :restaurant_tables, path: "tables", only: [:index, :show, :create, :update, :destroy] do
          member do
            post :rotate_token
          end
        end

        resources :business_memberships, path: "team", only: [:index, :create, :update, :destroy]

        resources :payment_methods, only: [:index, :create, :update, :destroy]
        resources :cash_movements, only: [:index, :create]
      end
    end
  end
end
