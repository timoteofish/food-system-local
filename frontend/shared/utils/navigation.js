const LOADING_PAGE = "/frontend/index.html";
const LOADING_TIME_MS = 10000;

export const goWithLoading = (targetPath) => {
  const next = encodeURIComponent(
    targetPath.startsWith("/frontend/")
      ? targetPath
      : `/frontend/${String(targetPath || "").replace(/^\/+/, "").replace(/^\.\/+/, "")}`
  );
  window.location.href = `${LOADING_PAGE}?next=${next}`;
};

export const LOADING_DURATION_MS = LOADING_TIME_MS;
