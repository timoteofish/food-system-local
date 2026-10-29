const allowedTransitions = {
  pending: new Set(["confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"]),
  confirmed: new Set(["preparing", "ready", "out_for_delivery", "completed", "cancelled"]),
  preparing: new Set(["ready", "out_for_delivery", "completed", "cancelled"]),
  ready: new Set(["out_for_delivery", "completed", "cancelled"]),
  out_for_delivery: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
};

export const canTransitionOrderStatus = (current, next) =>
  current === next || Boolean(allowedTransitions[current]?.has(next));
