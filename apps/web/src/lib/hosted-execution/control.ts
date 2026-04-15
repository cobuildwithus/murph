import {
  createCloudflareHostedControlClient,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";
import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedExecutionOutboxPayload,
} from "@murphai/hosted-execution/outbox-payload";
import {
  HOSTED_USER_VERIFIED_EMAIL_ENV_KEY,
  createHostedVerifiedEmailUserEnv,
} from "@murphai/runtime-state";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import { readHostedExecutionControlBaseUrl } from "./environment";
import { formatHostedExecutionSafeLogError } from "./logging";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedVerifiedEmailSyncResult {
  emailAddress: string;
  verifiedAt: string;
}

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

export async function maybeStageHostedExecutionDispatchPayload(
  dispatch: HostedExecutionDispatchRequest,
): Promise<HostedExecutionOutboxPayload | null> {
  const client = readHostedExecutionControlClientIfConfigured();
  return client ? client.storeDispatchPayload(dispatch) : null;
}

export async function deleteHostedStoredDispatchPayloadBestEffort(
  payload: HostedExecutionOutboxPayload,
): Promise<void> {
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    return;
  }

  try {
    await client.deleteStoredDispatchPayload(payload);
  } catch (error) {
    console.error(
      "Hosted stored dispatch payload cleanup failed.",
      formatHostedExecutionSafeLogError(error),
    );
  }
}

export async function syncHostedVerifiedEmailToHostedExecution(input: {
  userId: string;
  emailAddress: string;
  verifiedAt: string;
}): Promise<HostedVerifiedEmailSyncResult> {
  const client = requireHostedExecutionControlClient();

  await client.updateUserEnv(input.userId, {
    env: createHostedVerifiedEmailUserEnv({
      address: input.emailAddress,
      verifiedAt: input.verifiedAt,
    }),
    mode: "merge",
  });

  return {
    emailAddress: input.emailAddress,
    verifiedAt: input.verifiedAt,
  };
}

export async function hasHostedVerifiedEmailUserEnv(userId: string): Promise<boolean | null> {
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    return null;
  }

  try {
    const status = await client.getUserEnvStatus(userId);
    return status.configuredUserEnvKeys.includes(HOSTED_USER_VERIFIED_EMAIL_ENV_KEY);
  } catch (error) {
    console.error(
      "Hosted verified email status lookup failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return null;
  }
}
