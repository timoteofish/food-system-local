import { getLanguage, translate } from "../../shared/i18n/i18n.js";

const messages = {
  "My deliveries": { en: "My deliveries", pt: "Minhas entregas" },
  "Enter the token provided by the restaurant to access your deliveries": {
    en: "Enter the token provided by the restaurant to access your deliveries",
    pt: "Informe o token fornecido pelo estabelecimento para acessar suas entregas",
  },
  "Courier token": { en: "Courier token", pt: "Token do entregador" },
  "Access deliveries": { en: "Access deliveries", pt: "Acessar entregas" },
  "Send my location": { en: "Send my location", pt: "Enviar minha localização" },
  "Sign out": { en: "Sign out", pt: "Sair" },
  "Waiting for pickup": { en: "Waiting for pickup", pt: "Aguardando coleta" },
  "In transit": { en: "In transit", pt: "Em trânsito" },
  Delivered: { en: "Delivered", pt: "Entregue" },
  Cancelled: { en: "Cancelled", pt: "Cancelada" },
  "Start delivery": { en: "Start delivery", pt: "Iniciar entrega" },
  "Complete delivery": { en: "Complete delivery", pt: "Concluir entrega" },
  "Could not access deliveries": { en: "Could not access deliveries", pt: "Não foi possível acessar as entregas" },
  "Courier: ": { en: "Courier: ", pt: "Entregador: " },
  "Unknown status": { en: "Unknown status", pt: "Situação desconhecida" },
  "Order ": { en: "Order ", pt: "Pedido " },
  "Address not provided": { en: "Address not provided", pt: "Endereço não informado" },
  "Number not provided": { en: "N/A", pt: "s/n" },
  Total: { en: "Total", pt: "Total" },
  "Update delivery": { en: "Update delivery", pt: "Atualizar entrega" },
  "No deliveries assigned.": { en: "No deliveries assigned.", pt: "Nenhuma entrega atribuída." },
  "Token removed from this device": { en: "Token removed from this device", pt: "Token removido deste dispositivo" },
  "Location is unavailable on this device": { en: "Location is unavailable on this device", pt: "A geolocalização não está disponível neste dispositivo" },
  "Requesting location": { en: "Requesting location", pt: "Solicitando localização" },
  "Location sent": { en: "Location sent", pt: "Localização enviada" },
  "Could not get your location": { en: "Could not get your location", pt: "Não foi possível obter sua localização" },
  "Courier token is invalid or expired": { en: "Courier token is invalid or expired", pt: "O token do entregador é inválido ou expirou" },
  "Invalid courier delivery status": { en: "Invalid courier delivery status", pt: "Situação de entrega inválida" },
  "Delivery not found": { en: "Delivery not found", pt: "Entrega não encontrada" },
  "Invalid courier delivery status transition": { en: "Invalid courier delivery status transition", pt: "Mudança de situação da entrega inválida" },
  "Delivery status changed; reload and try again": { en: "Delivery status changed; reload and try again", pt: "A situação da entrega mudou; atualize a página e tente novamente" },
  "Courier location must be an object": { en: "Courier location must be an object", pt: "A localização do entregador precisa ser um objeto" },
  "Invalid courier location": { en: "Invalid courier location", pt: "Localização do entregador inválida" },
  "Location sharing is available only during an active delivery": { en: "Location sharing is available only during an active delivery", pt: "O compartilhamento de localização só fica disponível durante uma entrega ativa" },
  "Courier location was updated too recently": { en: "Courier location was updated too recently", pt: "A localização do entregador foi atualizada há pouco tempo" },
  "Courier location updates are temporarily rate limited": { en: "Courier location updates are temporarily rate limited", pt: "As atualizações da localização do entregador estão temporariamente limitadas" },
};

export const translateCourier = (key) => {
  const entry = messages[key];
  if (entry) return entry[getLanguage()] || entry.en;
  return translate(key);
};

export const applyCourierTranslations = (root = document) => {
  root.querySelectorAll("[data-courier-i18n]").forEach((element) => {
    element.textContent = translateCourier(element.dataset.courierI18n);
  });
};
