import {
  createCloudflareHostedControlClient,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";
import { Agent } from "undici";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import {
  readHostedExecutionControlBaseUrl,
  readHostedExecutionControlEnvironment,
} from "./environment";

const hostedExecutionControlKeepAliveAgent = new Agent({
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
