import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const nonPublicRanges = {
  ipv4: new BlockList(),
  ipv6: new BlockList(),
};
for (const [address, prefix, type] of [
  ["0.0.0.0", 8, "ipv4"], ["10.0.0.0", 8, "ipv4"], ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"], ["169.254.0.0", 16, "ipv4"], ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"], ["192.0.2.0", 24, "ipv4"], ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"], ["198.18.0.0", 15, "ipv4"], ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"], ["224.0.0.0", 4, "ipv4"], ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"], ["::1", 128, "ipv6"], ["::ffff:0:0", 96, "ipv6"],
  ["64:ff9b::", 96, "ipv6"], ["64:ff9b:1::", 48, "ipv6"], ["100::", 64, "ipv6"], ["2001::", 23, "ipv6"],
  ["2001:db8::", 32, "ipv6"], ["2002::", 16, "ipv6"], ["3fff::", 20, "ipv6"],
  ["fc00::", 7, "ipv6"], ["fe80::", 10, "ipv6"], ["ff00::", 8, "ipv6"],
]) nonPublicRanges[type].addSubnet(address, prefix, type);

export const isPublicAddress = (address) => {
  const family = isIP(address);
  if (family === 4) return !nonPublicRanges.ipv4.check(address, "ipv4");
  if (family === 6) return /^[23]/.test(address) && !nonPublicRanges.ipv6.check(address, "ipv6");
  return false;
};

export const resolvePublicHttpsAddress = async (url, lookupHost = lookup) => {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Outbound URL must use HTTPS without embedded credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(hostname);
  const addresses = ipVersion
    ? [{ address: hostname, family: ipVersion }]
    : await lookupHost(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Outbound HTTPS URL must resolve only to public addresses");
  }
  return addresses[0];
};

export const requestPublicHttps = async (url, { method = "GET", body } = {}) => {
  const selected = await resolvePublicHttpsAddress(url);

  return new Promise((resolve, reject) => {
    let responseBytes = 0;
    let settled = false;
    let totalTimeout;
    const finish = (error, status) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeout);
      if (error) reject(error);
      else resolve(status);
    };
    const request = httpsRequest(url, {
      method,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      timeout: 10000,
    }, (response) => {
      response.on("data", (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > 1024 * 1024) request.destroy(new Error("Outbound HTTPS response exceeded 1 MiB"));
      });
      response.on("end", () => finish(null, response.statusCode || 502));
      response.on("aborted", () => finish(new Error("Outbound HTTPS response was interrupted")));
      response.on("error", (error) => finish(error));
      response.resume();
    });
    totalTimeout = setTimeout(() => request.destroy(new Error("Outbound HTTPS request exceeded 10 seconds")), 10_000);
    request.on("timeout", () => request.destroy(new Error("Outbound HTTPS request timed out")));
    request.on("error", (error) => finish(error));
    request.end(body);
  });
};
