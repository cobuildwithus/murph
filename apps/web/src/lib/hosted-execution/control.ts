import {
  createCloudflareHostedControlClient,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";
import { Agent, buildConnector } from "undici";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import {
  readHostedExecutionControlBaseUrl,
  readHostedExecutionControlEnvironment,
} from "./environment";

const connectHostedControl = buildConnector({});
const hostedExecutionControlKeepAliveAgent = new Agent({
  connect(options, callback) {
    const startedAt = performance.now();
    connectHostedControl(options, (...result) => {
      const elapsedMs = Math.round(performance.now() - startedAt);
      // New-connection cost only; HTTP response time and reused sockets are
      // not measured here. Native connector owns TLS, timeout and pooling.
      try {
        if (result[0] || elapsedMs >= 250) {
          console.info("Hosted control connection timing.", {
            event: "hosted-control.connect.timing",
            elapsedMs,
            encrypted: options.protocol === "https:",
            completed: result[0] === null,
          });
        }
      } catch { /* Optional diagnostics cannot replace connection completion. */ }
      callback(...result);
    });
  },
  // Reused direct-ensure arrivals measured 12-255ms vs ~600-850ms after the
  // old 60s window expired; 300s covers common 1-5 minute conversation gaps
  // while staying below Cloudflare's ~400s idle edge window. Stale-socket
  // ECONNRESET remains tolerated by this best-effort direct wake plus Temporal.
  keepAliveMaxTimeout: 600_000,
  keepAliveTimeout: 300_000,
});

export function readHostedExecutionControlClientIfConfigured(
  timeoutMs?: number,
): CloudflareHostedControlClient | null {
  const { controlTimeoutMs } = readHostedExecutionControlEnvironment();
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    return null;
  }

  return createCloudflareHostedControlClient({
    allowHttpLocalhost: true,
    baseUrl,
    fetchImpl: fetchHostedExecutionControlWithKeepAlive,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
    timeoutMs: typeof timeoutMs === "number" ? timeoutMs : controlTimeoutMs,
  });
}

function fetchHostedExecutionControlWithKeepAlive(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  const initWithDispatcher: RequestInit & { dispatcher: Agent } = {
    ...init,
    dispatcher: hostedExecutionControlKeepAliveAgent,
  };

  return fetch(input, initWithDispatcher);
}
