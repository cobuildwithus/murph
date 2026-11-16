import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { ConnectionError } from "./errors";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicConnectionAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export function connectionUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectionError("invalid_url"); }
  if (url.protocol !== "https:") throw new ConnectionError("not_https");
  if (url.username || url.password || url.hash || value.length > 2048) throw new ConnectionError("invalid_url");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "strava.com" || host.endsWith(".strava.com")) throw new ConnectionError("provider_terms");
  if (isIP(host) && !isPublicConnectionAddress(host)) throw new ConnectionError("unsafe_destination");
  return url;
}

export async function resolveConnectionAddresses(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new ConnectionError("unreachable")), { once: true })),
  ]);
  if (!addresses.length || addresses.some(({ address }) => !isPublicConnectionAddress(address))) throw new ConnectionError("unsafe_destination");
  return addresses;
}

export type ConnectionFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** One address resolution per request; the socket lookup never consults DNS again. */
export const guardedConnectionFetch: ConnectionFetch = async (input, init = {}) => {
  const url = connectionUrl(String(input));
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const controller = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), 15_000);
  let agent: Agent | undefined;
  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    controller.abort();
    await agent?.destroy();
  }
  try {
    signal.throwIfAborted();
    const addresses = await resolveConnectionAddresses(hostname, signal);
    const pinned = addresses[0]!;
    agent = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (_host !== hostname || !isPublicConnectionAddress(pinned.address)) {
        callback(new Error("Destination rejected"), "", 4);
      } else if (options.all) {
        callback(null, [pinned]);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    } } });
    const response = await undiciFetch(url, {
      method: init.method, headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body as string | URLSearchParams | undefined,
      signal, redirect: "manual", dispatcher: agent,
    });
    if (response.status >= 300 && response.status < 400) throw new ConnectionError("unsafe_destination");
    if (!response.body) {
      await cleanup();
      return new Response(null, { status: response.status, headers: Object.fromEntries(response.headers) });
    }
    const reader = response.body.getReader();
    let size = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const result = await reader.read();
          if (result.done) { stream.close(); await cleanup(); return; }
          size += result.value.byteLength;
          if (size > 1_048_576) throw new ConnectionError("limit");
          stream.enqueue(result.value);
        } catch (error) {
          stream.error(error instanceof ConnectionError ? error : new ConnectionError("unreachable", 502));
          await reader.cancel().catch(() => undefined);
          await cleanup();
        }
      },
      async cancel() { await reader.cancel().catch(() => undefined); await cleanup(); },
    });
    return new Response(body, { status: response.status, headers: Object.fromEntries(response.headers) });
  } catch (error) {
    await cleanup();
    throw error instanceof ConnectionError ? error : new ConnectionError("unreachable", 502);
  }
};
