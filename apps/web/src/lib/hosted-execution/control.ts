import {
  createCloudflareHostedControlClient,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import { readHostedExecutionControlBaseUrl } from "./environment";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export function readHostedExecutionControlClientIfConfigured(
  timeoutMs?: number,
): CloudflareHostedControlClient | null {
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    return null;
  }

  return createCloudflareHostedControlClient({
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
  });
}

export function requireHostedExecutionControlClient(): CloudflareHostedControlClient {
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted execution control is not configured yet. Contact support to finish setup.",
      httpStatus: 500,
    });
  }

  return client;
}
