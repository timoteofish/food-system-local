import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const isPublicAddress = (address) => {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && [0, 168].includes(b)) || (a === 192 && b === 88 && octets[2] === 99)
      || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return !normalized.startsWith("::ffff:") && !normalized.startsWith("2001:db8:")
      && !normalized.startsWith("2002:") && /^[23]/.test(normalized);
  }
  return false;
};

export const requestPublicHttps = async (url, { method = "GET", body } = {}) => {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(hostname);
  const addresses = ipVersion
    ? [{ address: hostname, family: ipVersion }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Outbound HTTPS URL must resolve only to public addresses");
  }

  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      timeout: 10000,
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode || 502));
    });
    request.on("timeout", () => request.destroy(new Error("Outbound HTTPS request timed out")));
    request.on("error", reject);
    request.end(body);
  });
};
