import {
  createCloudflareHostedControlClient,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import { readHostedExecutionControlBaseUrl } from "./environment";

export function readHostedExecutionControlClientIfConfigured(
  timeoutMs?: number,
): CloudflareHostedControlClient | null {
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    return null;
  }

  return createCloudflareHostedControlClient({
    allowHttpLocalhost: true,
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
  });
}
