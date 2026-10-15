module Api
  module V1
    class AuthController < ApplicationController
      before_action :limit_auth_attempts!, only: [:register, :login, :firebase]

      def register
        @user = User.new(user_params)

        if @user.save
          token = @user.generate_api_token
          issue_session_cookie(token)
          @business = Business.create!(
            user: @user,
            name: @user.business_name,
            primary_color: "#0f766e",
            theme_style: :clean,
            status: :active,
            settings: { tax_rate: 0, delivery_fee: 0, currency: "BRL" }
          )

          seed_default_categories(@business)
          ensure_owner_membership(@business, @user)

          render json: {
            message: "User created successfully",
            user: user_payload(@user),
            business: business_payload(@business)
          }, status: :created
        else
          render json: {
            error: "Failed to create user",
            errors: @user.errors.messages
          }, status: :unprocessable_entity
        end
      end

      def firebase
        verified_payload = firebase_verifier.verify!(firebase_params[:id_token])

        email = verified_payload["email"].to_s.downcase.strip
        google_uid = verified_payload["user_id"].presence || verified_payload["sub"].presence

        if email.blank? || google_uid.blank?
          return render json: { error: "Dados do Firebase incompletos." }, status: :unprocessable_entity
        end

        user_attributes = {
          email: email,
          full_name: verified_payload["name"].presence || verified_payload["email"],
          business_name: verified_payload["name"].presence || verified_payload["email"],
          google_uid: google_uid,
          avatar_url: verified_payload["picture"].presence,
          email_verified: verified_payload["email_verified"],
          provider: "google"
        }

        @user = User.find_by(google_uid: google_uid) || User.find_by(email: email)

        ActiveRecord::Base.transaction do
          if @user
            @user.update!(google_user_attributes(user_attributes, existing_user: @user))
          else
            generated_password = SecureRandom.hex(24)
            @user = User.create!(
              google_user_attributes(user_attributes).merge(
                password: generated_password,
                password_confirmation: generated_password
              )
            )
          end

          @business = @user.business || Business.create!(
            user: @user,
            name: @user.business_name,
            primary_color: "#0f766e",
            theme_style: :clean,
            status: :active,
            settings: { tax_rate: 0, delivery_fee: 0, currency: "BRL" }
          )

          seed_default_categories(@business) if @business.categories.empty?
          ensure_owner_membership(@business, @user)
          @user.update!(last_login_at: Time.current)
        end

        token = @user.generate_api_token
        issue_session_cookie(token)

        render json: {
            message: "Firebase authentication successful",
            user: user_payload(@user),
            business: business_payload(current_business_for_user)
          }, status: :ok
      rescue FirebaseTokenVerifier::VerificationError => e
        render json: { error: e.message }, status: :unauthorized
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: "Falha ao autenticar com Firebase.", errors: e.record.errors.messages }, status: :unprocessable_entity
      end

      def firebase_config
        config = firebase_public_config

        if config.values.any?(&:blank?)
          return render json: { enabled: false, error: "Firebase nao configurado." }, status: :ok
        end

        render json: {
          enabled: true,
          config: config
        }, status: :ok
      end

      def login
        @user = User.find_by(email: login_params[:email].to_s.downcase.strip)

        if @user&.active? && @user&.authenticate(login_params[:password])
          token = @user.generate_api_token
          issue_session_cookie(token)
          @user.update(last_login_at: Time.current)
          render json: {
            message: "Login successful",
            user: user_payload(@user),
            business: business_payload(current_business_for_user)
          }, status: :ok
        else
          render json: { error: "Invalid credentials" }, status: :unauthorized
        end
      end

      def refresh
        authenticate_user!
        return if performed?

        token = @current_user.generate_api_token
        issue_session_cookie(token)
        render json: { message: "Session refreshed" }, status: :ok
      end

      def logout
        authenticate_user!
        return if performed?

        clear_session_cookie
        render json: { message: "Logout successful" }, status: :ok
      end

      def profile
        authenticate_user!
        return if performed?

        render json: {
          user: user_payload(@current_user),
          business: business_payload(current_business_for_user)
        }, status: :ok
      end

      private

      def limit_auth_attempts!
        rate_limit!(key: "auth:#{request.remote_ip}", limit: 30, period: 10.minutes)
      end

      def user_params
        params.require(:user).permit(:email, :password, :password_confirmation, :business_name, :phone)
      end

      def firebase_params
        params.require(:firebase_auth).permit(:id_token)
      end

      def login_params
        params.require(:user).permit(:email, :password)
      end

      def firebase_public_config
        {
          apiKey: ENV["FIREBASE_WEB_API_KEY"],
          authDomain: ENV["FIREBASE_AUTH_DOMAIN"],
          projectId: ENV["FIREBASE_PROJECT_ID"],
          appId: ENV["FIREBASE_APP_ID"]
        }
      end

      def firebase_verifier
        @firebase_verifier ||= FirebaseTokenVerifier.new(project_id: ENV["FIREBASE_PROJECT_ID"])
      end

      def seed_default_categories(business)
        %w[Hamburgueres Bebidas Acompanhamentos Sobremesas].each_with_index do |name, index|
          business.categories.create!(name: name, position: index + 1, status: :active)
        end
        (1..6).each do |number|
          business.restaurant_tables.find_or_create_by!(name: "Mesa #{number.to_s.rjust(2, "0")}")
        end
      end

      def ensure_owner_membership(business, user)
        business.business_memberships.find_or_create_by!(user: user) do |membership|
          membership.role = :owner
          membership.status = :active
        end
      end

      def google_user_attributes(payload, existing_user: nil)
        full_name = payload[:full_name].presence || existing_user&.full_name.presence || payload[:business_name].presence || "Usuario Google"
        business_name = payload[:business_name].presence || existing_user&.business_name.presence || full_name

        {
          email: payload[:email].to_s.downcase.strip,
          full_name: full_name,
          business_name: business_name,
          phone: payload[:phone].presence || existing_user&.phone,
          provider: "google",
          google_uid: payload[:google_uid].presence || payload[:sub].presence,
          avatar_url: payload[:avatar_url].presence || existing_user&.avatar_url,
          email_verified: ActiveModel::Type::Boolean.new.cast(payload[:email_verified]),
          status: :active
        }
      end
    end
  end
end
