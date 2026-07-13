import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "./client-api";

import {
  HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS,
  type HostedPrivyClientPendingAction,
  type HostedPrivyFinalizationState,
} from "@/src/lib/hosted-onboarding/privy-client";
import type {
  HostedPrivyAuthMethod,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";

import { waitForRetryDelay } from "./hosted-retry-support";

const HOSTED_PRIVY_AUTH_RESTART_REQUIRED_CODES = new Set([
  "HOSTED_AUTH_PROOF_EXPIRED",
  "HOSTED_AUTH_PROOF_INVALID",
]);

export function isHostedPrivyAuthRestartRequiredError(error: unknown): boolean {
  return (
    error instanceof HostedOnboardingApiError
    && error.code !== null
    && HOSTED_PRIVY_AUTH_RESTART_REQUIRED_CODES.has(error.code)
  );
}

interface HostedPrivyFinalizationAttemptInput {
  action: "continue" | "verify-code";
  finalize: () => Promise<void>;
  getFinalizationState: () => HostedPrivyFinalizationState;
  setPendingAction: (action: HostedPrivyClientPendingAction) => void;
  updateFinalizationState: (nextState: HostedPrivyFinalizationState) => void;
}

export async function runHostedPrivyFinalizationAttempt({
  action,
  finalize,
  getFinalizationState,
  setPendingAction,
  updateFinalizationState,
}: HostedPrivyFinalizationAttemptInput): Promise<void> {
  if (getFinalizationState() !== "idle") {
    return;
  }

  setPendingAction(action);
  updateFinalizationState("running");

  try {
    await finalize();
    updateFinalizationState("completed");
  } catch (error) {
    updateFinalizationState("idle");
    throw error;
  } finally {
    if (getFinalizationState() === "idle") {
      setPendingAction(null);
    }
  }
}

export function buildHostedPrivyCompletionRequestPayload(input: {
  inviteCode?: string | null;
}): Record<string, unknown> {
  const timeZone = resolveHostedBrowserTimeZone();

  return {
    ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
    ...(timeZone ? { timeZone } : {}),
  };
}

export async function requestHostedPrivyCompletionWithRetry(input: {
  inviteCode?: string | null;
}): Promise<HostedPrivyCompletionPayload> {
  let lastError: unknown = null;

  for (const delayMs of HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await waitForRetryDelay(delayMs);
    }

    try {
      return await requestHostedOnboardingJson<HostedPrivyCompletionPayload>({
        payload: buildHostedPrivyCompletionRequestPayload(input),
        url: "/api/hosted-onboarding/privy/complete",
      });
    } catch (error) {
      lastError = error;

      if (!isRetryableHostedPrivyCompletionError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("We couldn't verify your sign-in. Try again.");
}

export async function requestHostedPrivyAuthIntent(input: {
  inviteCode?: string | null;
  method: HostedPrivyAuthMethod;
}): Promise<void> {
  await requestHostedOnboardingJson<{ ok: true }>({
    payload: {
      method: input.method,
      ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
    },
    url: "/api/hosted-onboarding/privy/begin",
  });
}

function isRetryableHostedPrivyCompletionError(error: unknown): boolean {
  if (!(error instanceof HostedOnboardingApiError)) {
    return false;
  }

  if (error.code === "AUTH_REQUIRED") {
    return true;
  }

  return (
    error.retryable &&
    (error.code === "PRIVY_ACCOUNT_NOT_READY" ||
      error.code === "PRIVY_EMAIL_NOT_READY" ||
      error.code === "PRIVY_TELEGRAM_NOT_READY" ||
      error.code === "PRIVY_PHONE_NOT_READY" ||
      error.code === "PRIVY_USER_LOOKUP_FAILED")
  );
}

function resolveHostedBrowserTimeZone(): string | null {
  if (typeof window === "undefined" || !("Intl" in window)) {
    return null;
  }

  try {
    const timeZone = window.Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" && timeZone.length > 0 ? timeZone : null;
  } catch {
    return null;
  }
}
