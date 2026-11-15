const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const isLoopbackHttpOrigin = (origin) => {
  if (typeof origin !== "string" || !origin) return false;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return url.origin === origin &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTS.has(hostname) &&
      !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
};
