// Normalizes provider payloads into the local external-order shape.
// Open Delivery (Abrasel) is the baseline: ifood, 99food and Keeta expose
// compatible order documents, so one adapter covers the three channels.

const MAX_ADAPTER_PAYLOAD_BYTES = 256 * 1024;
const MAX_EXTERNAL_ID_LENGTH = 190;

export const OPEN_DELIVERY_STATUS = Object.freeze({
  RECEIVED: "received",
  ACCEPTED: "accepted",
  PREPARING: "preparing",
  READY: "ready",
  DISPATCHED: "out_for_delivery",
  DELIVERED: "completed",
  CANCELLED: "cancelled",
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const centsToAmount = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value / 100;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value) / 100;
  return 0;
};

/**
 * Converts an Open Delivery order document into the payload stored in
 * external_orders.payload. Throws on malformed input so the poller can count a
 * failed attempt instead of persisting garbage.
 */
export const normalizeOpenDeliveryOrder = (raw) => {
  if (!isObject(raw)) throw new Error("Open Delivery order must be an object");
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_ADAPTER_PAYLOAD_BYTES) {
    throw new Error("Open Delivery order exceeds the 256 KB payload limit");
  }

  const externalOrderId = firstString(
    raw.id,
    raw.orderId,
    raw.external_order_id,
    raw.receipt?.id,
  );
  if (!externalOrderId || externalOrderId.length > MAX_EXTERNAL_ID_LENGTH) {
    throw new Error("Open Delivery order requires an id of at most 190 characters");
  }

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = rawItems.map((item) => ({
    id: firstString(item.id, item.productId, item.externalId),
    name: firstString(item.name, item.description, item.product?.name),
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1,
    unitPrice: centsToAmount(item.unitPrice ?? item.price ?? item.unit_price),
    notes: firstString(item.notes, item.observation),
  }));

  const customer = isObject(raw.customer) ? raw.customer : {};
  const delivery = isObject(raw.delivery) ? raw.delivery : {};
  const total = centsToAmount(raw.total ?? raw.totalAmount ?? raw.amount);

  return {
    schema: "open-delivery",
    external_order_id: externalOrderId,
    status: firstString(raw.status, raw.state) || OPEN_DELIVERY_STATUS.RECEIVED,
    received_at: firstString(raw.createdAt, raw.created_at, raw.receivedAt) || null,
    customer: {
      name: firstString(customer.name, raw.customerName),
      phone: firstString(customer.phone, customer.telephone),
    },
    delivery: {
      address: firstString(delivery.address?.street, delivery.address, raw.deliveryAddress),
      number: firstString(delivery.address?.number),
      notes: firstString(delivery.notes, delivery.observation),
    },
    items,
    total: total || items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    payment: {
      method: firstString(raw.payment?.method, raw.paymentMethod),
      changeFor: centsToAmount(raw.payment?.changeFor ?? raw.changeFor),
    },
    raw,
  };
};

const STATUS_ALIASES = new Map([
  ["new", OPEN_DELIVERY_STATUS.RECEIVED],
  ["created", OPEN_DELIVERY_STATUS.RECEIVED],
  ["pending", OPEN_DELIVERY_STATUS.RECEIVED],
  ["confirmed", OPEN_DELIVERY_STATUS.ACCEPTED],
  ["preparing", OPEN_DELIVERY_STATUS.PREPARING],
  ["in_preparation", OPEN_DELIVERY_STATUS.PREPARING],
  ["ready", OPEN_DELIVERY_STATUS.READY],
  ["dispatched", OPEN_DELIVERY_STATUS.DISPATCHED],
  ["delivered", OPEN_DELIVERY_STATUS.DELIVERED],
  ["cancelled", OPEN_DELIVERY_STATUS.CANCELLED],
  ["canceled", OPEN_DELIVERY_STATUS.CANCELLED],
]);

/** Maps a provider status to the external_orders status enum. */
export const normalizeOpenDeliveryStatus = (value) => {
  const status = firstString(value).toLowerCase();
  if (STATUS_ALIASES.has(status)) return STATUS_ALIASES.get(status);
  if (Object.values(OPEN_DELIVERY_STATUS).includes(status)) return status;
  return null;
};
