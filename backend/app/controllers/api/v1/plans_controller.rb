module Api
  module V1
    class PlansController < ApplicationController
      def index
        render json: Plan.active.ordered.map { |plan| plan_payload(plan) }, status: :ok
      end
    end
  end
end
