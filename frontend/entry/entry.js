const DEFAULT_TARGET = "/frontend/pages/app/dashboard/index.html";
const LOADING_TIME_MS = 5600;

const params = new URLSearchParams(window.location.search);
const target = params.get("next") || DEFAULT_TARGET;

window.setTimeout(() => {
  window.location.href = new URL(target, window.location.href).href;
}, LOADING_TIME_MS);
