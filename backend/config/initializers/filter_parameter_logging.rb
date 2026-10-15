Rails.application.config.filter_parameters += [
  :passw, :password, :password_confirmation, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc
]
