// Opens an external HTTPS URL in the system browser, using the Tauri command
// when running inside the desktop app and window.open as a browser fallback.
export const openExternalUrl = async (url) => {
  try {
    if (window.__TAURI__?.core?.invoke) {
      await window.__TAURI__.core.invoke("open_external_url", { url });
      return;
    }
  } catch {
    // Fall back to the browser when the desktop command is unavailable.
  }
  window.open(url, "_blank", "noopener,noreferrer");
};
