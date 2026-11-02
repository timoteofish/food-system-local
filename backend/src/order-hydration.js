const ORDER_QUERY_BATCH_SIZE = 250;

const chunk = (values, size) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

export const hydrateOrders = async (orders, query) => {
  if (!orders.length) return orders;

  const orderIds = orders.map((order) => order.id);
  const itemsByOrder = new Map(orderIds.map((id) => [id, []]));
  const paymentsByOrder = new Map(orderIds.map((id) => [id, []]));

  for (const ids of chunk(orderIds, ORDER_QUERY_BATCH_SIZE)) {
    const placeholders = ids.map(() => "?").join(",");
    const [[items], [payments]] = await Promise.all([
      query(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, created_at`,
        ids,
      ),
      query(
        `SELECT op.*, pm.name AS payment_method_name FROM order_payments op JOIN payment_methods pm ON pm.id = op.payment_method_id WHERE op.order_id IN (${placeholders}) ORDER BY op.order_id, op.created_at`,
        ids,
      ),
    ]);

    for (const item of items) itemsByOrder.get(item.order_id)?.push(item);
    for (const payment of payments) paymentsByOrder.get(payment.order_id)?.push(payment);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id),
    payments: paymentsByOrder.get(order.id),
  }));
};
