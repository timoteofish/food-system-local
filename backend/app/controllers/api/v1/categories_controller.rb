module Api
  module V1
    class CategoriesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_business
      before_action :authorize_business!
      before_action :set_category, only: [:update, :destroy]

      def index
        @categories = @business.categories.ordered
        render json: @categories.map { |category| category_payload(category) }, status: :ok
      end

      def create
        @category = @business.categories.build(category_params)

        if @category.save
          render json: category_payload(@category), status: :created
        else
          render json: { error: "Failed to create category", errors: @category.errors.messages }, status: :unprocessable_entity
        end
      end

      def update
        if @category.update(category_params)
          render json: category_payload(@category), status: :ok
        else
          render json: { error: "Failed to update category", errors: @category.errors.messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @category.destroy
        render json: { message: "Category deleted successfully" }, status: :ok
      end

      private

      def set_business
        @business = Business.find(params[:business_id])
      end

      def set_category
        @category = @business.categories.find(params[:id])
      end

      def authorize_business!
        authorize_business_access!(@business, permission: :manage_menu)
      end

      def category_params
        params.require(:category).permit(:name, :description, :position, :status)
      end

      def category_payload(category)
        {
          id: category.id,
          name: category.name,
          description: category.description,
          position: category.position
        }
      end
    end
  end
end
