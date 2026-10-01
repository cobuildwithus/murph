import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import type { HostedPrivyAuthMethod } from "@/src/lib/hosted-onboarding/types";

import { retrySyncOperation, toErrorMessage } from "./hosted-settings-sync-helpers";

export interface HostedLinkedAccountRemovalResult {
  changed: boolean;
  method: HostedPrivyAuthMethod;
  ok: true;
  runTriggered: boolean;
}

export async function finishHostedLinkedAccountRemovalWithRetry(input: {
  expectedIdentity: string;
  method: HostedPrivyAuthMethod;
  sleepImpl?: (delayMs: number) => Promise<void>;
}): Promise<HostedLinkedAccountRemovalResult> {
  return retrySyncOperation({
    errorFactory: (message) => new Error(message),
    operation: () => requestHostedOnboardingJson<HostedLinkedAccountRemovalResult>({
      method: "DELETE",
      payload: {
        expectedIdentity: input.expectedIdentity,
        method: input.method,
      },
      url: "/api/settings/linked-account",
    }),
    retryable: (error) =>
      error instanceof HostedOnboardingApiError
      && error.code === "PRIVY_ACCOUNT_UNLINK_NOT_READY",
    sleepImpl: input.sleepImpl,
    timeoutMessage:
      "The sign-in was removed, but Murph could not finish disconnecting it yet. Try again.",
  });
}

export function toHostedLinkedAccountRemovalErrorMessage(
  error: unknown,
  providerAccountRemoved: boolean,
): string {
  if (
    error instanceof HostedOnboardingApiError
    && error.code === "LINKED_ACCOUNT_LAST_SIGN_IN"
  ) {
    return "Add another email, phone, or Telegram sign-in before removing this one.";
  }

  if (providerAccountRemoved) {
    return toErrorMessage(
      error,
      "The sign-in was removed, but Murph could not finish disconnecting it yet. Try again.",
    );
  }

  return toErrorMessage(
    error,
    "Could not remove this sign-in right now. Try again.",
  );
}
