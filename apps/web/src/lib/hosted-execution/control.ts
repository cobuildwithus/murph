import {
  createCloudflareHostedControlClient,
  type CloudflareHostedControlClient,
} from "@murphai/cloudflare-hosted-control/client";
import type {
  CloudflareHostedManagedUserCryptoStatus,
} from "@murphai/cloudflare-hosted-control/contracts";
import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedExecutionOutboxPayload,
} from "@murphai/hosted-execution/outbox-payload";
import { createHostedVerifiedEmailUserEnv } from "@murphai/runtime-state";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import { readHostedExecutionControlBaseUrl } from "./environment";
import { formatHostedExecutionSafeLogError } from "./logging";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "../hosted-onboarding/logging";

export interface HostedVerifiedEmailSyncResult {
  emailAddress: string;
  runTriggered: boolean;
  verifiedAt: string;
}

export type HostedManagedUserCryptoWarmupTrigger =
  | "billing-checkout-route"
  | "privy-complete-checkout";

export type HostedDeferredWorkScheduler = (callback: () => Promise<void> | void) => void;

export function readHostedExecutionControlClientIfConfigured(): CloudflareHostedControlClient | null {
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    return null;
  }

  return createCloudflareHostedControlClient({
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
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

  try {
    await client.run(input.userId);

    return {
      emailAddress: input.emailAddress,
      runTriggered: true,
      verifiedAt: input.verifiedAt,
    };
  } catch (error) {
    console.error(
      "Hosted verified email sync saved user env but could not trigger a hosted run.",
      formatHostedExecutionSafeLogError(error),
    );

    return {
      emailAddress: input.emailAddress,
      runTriggered: false,
      verifiedAt: input.verifiedAt,
    };
  }
}

export async function provisionManagedUserCryptoInHostedExecution(
  userId: string,
): Promise<CloudflareHostedManagedUserCryptoStatus> {
  return requireHostedExecutionControlClient().provisionManagedUserCrypto(userId);
}

export async function preProvisionManagedUserCryptoInHostedExecutionBestEffort(input: {
  trigger: HostedManagedUserCryptoWarmupTrigger;
  userId: string;
}): Promise<boolean> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.crypto-warmup", {
    trigger: input.trigger,
  });
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    finishHostedOnboardingTiming(timing, "skipped", {
      reason: "control-unconfigured",
    });
    return false;
  }

  try {
    await client.provisionManagedUserCrypto(input.userId);
    finishHostedOnboardingTiming(timing, "completed");
    return true;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    console.error(
      `Hosted managed user crypto warmup failed during ${input.trigger}.`,
      formatHostedExecutionSafeLogError(error),
    );
    return false;
  }
}

export function scheduleManagedUserCryptoWarmupBestEffort(input: {
  schedule: HostedDeferredWorkScheduler;
  trigger: HostedManagedUserCryptoWarmupTrigger;
  userId: string;
}): "after" | "fallback-inline" {
  const runWarmup = () => preProvisionManagedUserCryptoInHostedExecutionBestEffort(input);

  try {
    input.schedule(async () => {
      await runWarmup();
    });
    return "after";
  } catch (error) {
    console.error(
      `Hosted managed user crypto warmup scheduling failed during ${input.trigger}. Falling back to inline dispatch.`,
      formatHostedExecutionSafeLogError(error),
    );
    void runWarmup();
    return "fallback-inline";
  }
}
