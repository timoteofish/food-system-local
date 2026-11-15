let restoreInProgress = false;
let activeRequests = 0;
let activeWork = 0;
let drainWaiters = [];

const notifyDrained = () => {
  if (activeRequests <= 1 && activeWork <= 1 && drainWaiters.length) {
    for (const resolve of drainWaiters) resolve();
    drainWaiters = [];
  }
};

export const enterRequest = () => {
  if (restoreInProgress) return false;
  activeRequests += 1;
  return true;
};

export const leaveRequest = () => {
  activeRequests = Math.max(0, activeRequests - 1);
  notifyDrained();
};

export const enterWork = () => { activeWork += 1; };
export const leaveWork = () => { activeWork = Math.max(0, activeWork - 1); notifyDrained(); };

export const trackRouteWork = (route) => {
  if (!(route.url.startsWith("/api/v1/") || route.url === "/up") || route.handler?.constructor?.name !== "AsyncFunction") return;
  const handler = route.handler;
  route.handler = async function (request, reply) {
    if (restoreInProgress && !request.maintenanceRequest) return reply.code(503).send({ error: "Database restore is in progress; retry shortly" });
    enterWork();
    try { return await handler.call(this, request, reply); }
    finally { leaveWork(); }
  };
};

export const beginRestore = async () => {
  if (restoreInProgress) return false;
  restoreInProgress = true;
  if (activeRequests > 1 || activeWork > 1) await new Promise((resolve) => drainWaiters.push(resolve));
  return true;
};

export const endRestore = () => {
  restoreInProgress = false;
};

export const isRestoreInProgress = () => restoreInProgress;
