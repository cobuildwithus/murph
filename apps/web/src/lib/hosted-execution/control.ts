import {
  createCloudflareHostedControlClient,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import {
  readHostedExecutionControlBaseUrl,
  readHostedExecutionDispatchEnvironment,
} from "./environment";

export function readHostedExecutionControlClientIfConfigured(
  timeoutMs?: number,
): CloudflareHostedControlClient | null {
  const { dispatchTimeoutMs } = readHostedExecutionDispatchEnvironment();
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    return null;
  }

  return createCloudflareHostedControlClient({
    allowHttpLocalhost: true,
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
    timeoutMs: typeof timeoutMs === "number" ? timeoutMs : dispatchTimeoutMs,
  });
}
