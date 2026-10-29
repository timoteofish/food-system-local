let restoreInProgress = false;
let activeRequests = 0;
let drainWaiters = [];

export const enterRequest = () => {
  if (restoreInProgress) return false;
  activeRequests += 1;
  return true;
};

export const leaveRequest = () => {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests <= 1 && drainWaiters.length) {
    for (const resolve of drainWaiters) resolve();
    drainWaiters = [];
  }
};

export const beginRestore = async () => {
  if (restoreInProgress) return false;
  restoreInProgress = true;
  if (activeRequests > 1) await new Promise((resolve) => drainWaiters.push(resolve));
  return true;
};

export const endRestore = () => {
  restoreInProgress = false;
};

export const isRestoreInProgress = () => restoreInProgress;
