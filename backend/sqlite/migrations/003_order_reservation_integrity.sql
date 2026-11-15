CREATE UNIQUE INDEX uq_inventory_reservation_active_order
ON inventory_reservations(order_id)
WHERE order_id IS NOT NULL AND status = 'held';
