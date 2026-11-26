// Payment protocol adapters. Terminal integrations speak HTTP JSON on the local
// network (or loopback); gateways create a hosted checkout and confirm via a
// signed webhook. Adapters only build/parse payloads — transport and persistence
// stay in routes/payments.js.

const MAX_PAYLOAD_BYTES = 64 * 1024;

export const TERMINAL_PROVIDERS = Object.freeze([
  "stone", "pagbank", "getnet", "cielo", "rede", "sicredi", "sicoob", "generic",
]);
export const GATEWAY_PROVIDERS = Object.freeze([
  "mercadopago", "pagbank", "asaas", "stripe", "pagarme",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const cents = (amount) => {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid payment amount");
  return Math.round(value * 100);
};

/** Builds the charge request body for a local terminal provider. */
export const buildTerminalCharge = (provider, { amount, installments, orderId, reference }) => {
  const valueInCents = cents(amount);
  const parsedInstallments = Number.isInteger(installments) && installments >= 1 && installments <= 24 ? installments : 1;
  const base = {
    amount: valueInCents,
    installments: parsedInstallments,
    order_id: orderId,
    reference,
  };
  switch (provider) {
    case "stone":
    case "generic":
      return { ...base, amount_cents: valueInCents };
    case "pagbank":
      return { ...base, value: valueInCents / 100, installments: parsedInstallments };
    case "getnet":
      return { ...base, amount: valueInCents / 100, parcelas: parsedInstallments };
    case "cielo":
    case "rede":
      return { ...base, valor: valueInCents / 100, parcelas: parsedInstallments };
    case "sicredi":
    case "sicoob":
      return { ...base, valor: valueInCents / 100, parcelas: parsedInstallments, referencia: reference };
    default:
      throw new Error(`Unsupported terminal provider: ${provider}`);
  }
};

const firstString = (...values) => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
};

const parseAmount = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed / 100;
  }
  return 0;
};

/** Normalizes a terminal response into the local card-payment shape. */
export const normalizeTerminalResponse = (provider, body, httpStatus) => {
  if (!isObject(body)) throw new Error("Terminal response must be an object");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Terminal response exceeds the 64 KB limit");
  }
  const statusText = firstString(body.status, body.resultado, body.state).toLowerCase();
  const approved = ["approved", "aprovado", "authorized", "captured", "success", "ok"].includes(statusText);
  const declined = ["declined", "recusado", "denied", "failed", "error", "canceled", "cancelled"].includes(statusText);
  const status = approved ? "approved" : declined ? "declined" : httpStatus >= 200 && httpStatus < 300 ? "approved" : "error";
  return {
    status,
    external_id: firstString(body.id, body.transaction_id, body.tid, body.nsu, body.external_id, body.payment_id),
    amount: parseAmount(body.amount_cents, body.amount, body.value, body.valor),
    raw: body,
  };
};

/** Builds a hosted-checkout request body for a gateway. */
export const buildGatewayCheckout = (provider, { amount, orderId, returnUrl, description }) => {
  const valueInCents = cents(amount);
  const base = { order_id: orderId, description, return_url: returnUrl };
  switch (provider) {
    case "mercadopago":
    case "pagarme":
      return { ...base, amount_in_cents: valueInCents, currency: "BRL" };
    case "asaas":
      return { ...base, value: valueInCents / 100, currency: "BRL" };
    case "pagbank":
      return { ...base, amount: valueInCents / 100, currency: "BRL" };
    case "stripe":
      return { ...base, amount: valueInCents, currency: "brl" };
    default:
      throw new Error(`Unsupported gateway provider: ${provider}`);
  }
};

/** Normalizes a gateway checkout response into a redirect URL and payment id. */
export const normalizeGatewayCheckout = (provider, body, httpStatus) => {
  if (!isObject(body)) throw new Error("Gateway response must be an object");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Gateway response exceeds the 64 KB limit");
  }
  const checkoutUrl = firstString(body.checkout_url, body.url, body.payment_url, body.init_point, body.hosted_checkout_url, body.link);
  let parsed;
  try { parsed = checkoutUrl ? new URL(checkoutUrl) : null; }
  catch { parsed = null; }
  if (!parsed || !["https:", "http:"].includes(parsed.protocol)) {
    throw new Error(`Gateway did not return a valid checkout URL (HTTP ${httpStatus})`);
  }
  return {
    checkout_url: parsed.toString(),
    external_id: firstString(body.id, body.payment_id, body.transaction_id, body.checkout_id),
    status: "pending",
    raw: body,
  };
};

/** Maps a gateway webhook event to a local card-payment status. */
export const normalizeGatewayWebhook = (provider, body) => {
  if (!isObject(body)) throw new Error("Gateway webhook must be an object");
  const rawStatus = firstString(
    body.status,
    body.status_detail,
    body.event,
    body.type,
    body.payment?.status,
    body.data?.object?.status,
    body.transaction?.status,
  ).toLowerCase();
  const approved = ["approved", "authorized", "captured", "paid", "confirmed", "succeeded", "success", "payment.approved", "payment.confirmed"].includes(rawStatus);
  const declined = ["declined", "rejected", "denied", "failed", "cancelled", "canceled", "refunded", "chargeback", "payment.declined", "payment.cancelled"].includes(rawStatus);
  return {
    status: approved ? "approved" : declined ? "declined" : "pending",
    external_id: firstString(body.id, body.payment_id, body.transaction_id, body.data?.object?.id, body.resource?.id),
    raw: body,
  };
};
