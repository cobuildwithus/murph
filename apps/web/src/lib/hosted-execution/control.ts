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
  keepAliveMaxTimeout: 120_000,
  keepAliveTimeout: 60_000,
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
