const LOADING_PAGE = "/index.html";
const LOADING_TIME_MS = 10000;

export const goWithLoading = (targetPath) => {
  const normalizedTarget = String(targetPath || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/^frontend(?=\/|$)/, "");
  const next = encodeURIComponent(`/${normalizedTarget}`);
  window.location.href = `${LOADING_PAGE}?next=${next}`;
};

export const LOADING_DURATION_MS = LOADING_TIME_MS;
