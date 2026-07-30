import "server-only";

import { LINQ_API_DEFAULT_TIMEOUT_MS } from "../linq/api";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export const HOSTED_GROUP_JOIN_PROVIDER_FENCE_LOCK_TIMEOUT_MS = 1_500;
const HOSTED_GROUP_JOIN_PROVIDER_FENCE_COMMIT_MARGIN_MS = 2_000;

export const HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  // The provider body remains inside its ten-second request timeout. Provider
  // entry is refused unless that full timeout and the commit margin remain.
  timeout: 15_000,
} as const;

export type HostedGroupJoinProviderFenceState = {
  providerRequestCompleted: boolean;
  providerRequestStarted: boolean;
  startedAtMs: number;
};

export function createHostedGroupJoinProviderFenceState(): HostedGroupJoinProviderFenceState {
  return {
    providerRequestCompleted: false,
    providerRequestStarted: false,
    startedAtMs: performance.now(),
  };
}

export function beginHostedGroupJoinProviderRequest(
  state: HostedGroupJoinProviderFenceState | undefined,
): void {
  if (!state) {
    return;
  }
  const elapsedMs = performance.now() - state.startedAtMs;
  const requiredRemainingMs =
    LINQ_API_DEFAULT_TIMEOUT_MS + HOSTED_GROUP_JOIN_PROVIDER_FENCE_COMMIT_MARGIN_MS;
  const remainingMs =
    HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS.timeout - elapsedMs;
  if (remainingMs < requiredRemainingMs) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_PROVIDER_FENCE_BUDGET_EXHAUSTED",
      httpStatus: 503,
      message: "Hosted Linq provider fence budget was exhausted before dispatch.",
      retryable: true,
    });
  }
  state.providerRequestStarted = true;
}
