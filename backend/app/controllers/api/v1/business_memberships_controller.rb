module Api
  module V1
    class BusinessMembershipsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_business
      before_action :authorize_team_management!
      before_action :set_membership, only: [:update, :destroy]

      def index
        render json: @business.business_memberships.includes(:user).order(:created_at).map { |membership| membership_payload(membership) }, status: :ok
      end

      def create
        user = User.find_or_initialize_by(email: membership_params[:email].to_s.downcase.strip)
        if user.new_record?
          generated_password = SecureRandom.hex(24)
          user.assign_attributes(
            password: generated_password,
            password_confirmation: generated_password,
            business_name: @business.name,
            full_name: membership_params[:full_name].presence || membership_params[:email],
            status: :active
          )
          user.save!
        end

        membership = @business.business_memberships.find_or_initialize_by(user: user)
        membership.role = membership_params[:role].presence || :viewer
        membership.status = :active
        membership.save!

        render json: membership_payload(membership), status: membership.previously_new_record? ? :created : :ok
      end

      def update
        if @membership.owner? && @business.business_memberships.active.owner.where.not(id: @membership.id).none?
          return render json: { error: "O restaurante precisa manter pelo menos um dono ativo." }, status: :unprocessable_entity
        end

        if @membership.update(update_membership_params)
          render json: membership_payload(@membership), status: :ok
        else
          render json: { error: "Failed to update team member", errors: @membership.errors.messages }, status: :unprocessable_entity
        end
      end

      def destroy
        if @membership.owner? && @business.business_memberships.active.owner.where.not(id: @membership.id).none?
          return render json: { error: "O restaurante precisa manter pelo menos um dono ativo." }, status: :unprocessable_entity
        end

        @membership.update!(status: :inactive)
        render json: { message: "Team member disabled successfully" }, status: :ok
      end

      private

      def set_business
        @business = Business.find(params[:business_id])
      end

      def set_membership
        @membership = @business.business_memberships.find(params[:id])
      end

      def authorize_team_management!
        authorize_business_access!(@business, permission: :manage_business)
      end

      def membership_params
        params.require(:membership).permit(:email, :full_name, :role)
      end

      def update_membership_params
        params.require(:membership).permit(:role, :status)
      end

      def membership_payload(membership)
        {
          id: membership.id,
          role: membership.role,
          status: membership.status,
          user: {
            id: membership.user.id,
            email: membership.user.email,
            name: membership.user.full_name.presence || membership.user.business_name
          }
        }
      end
    end
  end
end
