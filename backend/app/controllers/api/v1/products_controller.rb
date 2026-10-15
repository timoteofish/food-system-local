module Api
  module V1
    class ProductsController < ApplicationController
      before_action :authenticate_user!, except: [:index_public]
      before_action :set_business
      before_action :authorize_business!, except: [:index_public]
      before_action :set_product, only: [:show, :update, :destroy]

      def index
        @products = @business.products.includes(:category).ordered
        @products = @products.by_category(params[:category_id]) if params[:category_id].present?
        render json: @products.map { |product| serialize_product(product) }, status: :ok
      end

      def index_public
        @products = @business.products.active.includes(:category).ordered
        render json: @products.map(&:to_menu_json), status: :ok
      end

      def show
        render json: serialize_product(@product), status: :ok
      end

      def create
        @product = @business.products.build(product_params)
        @product.category = find_or_create_category(params.dig(:product, :category_name) || params.dig(:product, :category))
        apply_active_flag(@product)

        if @product.save
          render json: serialize_product(@product), status: :created
        else
          render json: { error: "Failed to create product", errors: @product.errors.messages }, status: :unprocessable_entity
        end
      end

      def update
        if params.dig(:product, :category_name).present? || params.dig(:product, :category).present?
          @product.category = find_or_create_category(params.dig(:product, :category_name) || params.dig(:product, :category))
        end
        apply_active_flag(@product)

        if @product.update(product_params)
          render json: serialize_product(@product), status: :ok
        else
          render json: { error: "Failed to update product", errors: @product.errors.messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @product.destroy
        render json: { message: "Product deleted successfully" }, status: :ok
      end

      private

      def set_business
        @business = Business.find(params[:business_id] || params[:id])
      end

      def set_product
        @product = @business.products.find(params[:id])
      end

      def authorize_business!
        authorize_business_access!(@business, permission: :manage_menu)
      end

      def product_params
        permitted = params.require(:product).permit(:name, :description, :price, :image_url, :status, :position)
        permitted[:price] = normalize_price(permitted[:price]) if permitted[:price].present?
        permitted[:image_url] = params.dig(:product, :image) if params.dig(:product, :image).present?
        permitted
      end

      def apply_active_flag(product)
        return unless params[:product].key?(:active)

        product.status = ActiveModel::Type::Boolean.new.cast(params.dig(:product, :active)) ? :active : :inactive
      end

      def normalize_price(value)
        return value.to_f if value.is_a?(Numeric)

        value.to_s.gsub(/[^\d,.-]/, "").tr(".", "").tr(",", ".").to_f
      end

      def find_or_create_category(name)
        normalized = name.to_s.strip
        return @business.categories.first if normalized.blank?

        @business.categories.find_or_create_by!(name: normalized) do |category|
          category.position = @business.categories.count + 1
          category.status = :active
        end
      end

      def serialize_product(product)
        product.to_menu_json.merge(
          id: product.id,
          category_id: product.category_id,
          position: product.position
        )
      end
    end
  end
end
