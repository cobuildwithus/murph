import {
  RUNTIME_LIVENESS_TOUCH_TIMEOUT_MAX_MS,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

export const CLOUDFLARE_RUNTIME_LIVENESS_INTERVAL_MS = 5_000;
export const ACTIVE_INVOCATION_HEARTBEAT_STALE_MS = 30_000;
const ACTIVE_INVOCATION_HEARTBEAT_STALE_MIN_MULTIPLIER = 3;
export const ACTIVE_INVOCATION_HEARTBEAT_STALE_MIN_MS =
  ACTIVE_INVOCATION_HEARTBEAT_STALE_MIN_MULTIPLIER
  * (CLOUDFLARE_RUNTIME_LIVENESS_INTERVAL_MS + RUNTIME_LIVENESS_TOUCH_TIMEOUT_MAX_MS);

function assertHostedRunnerLivenessTimingInvariant(): void {
  if (ACTIVE_INVOCATION_HEARTBEAT_STALE_MS < ACTIVE_INVOCATION_HEARTBEAT_STALE_MIN_MS) {
    throw new Error(
      "Hosted runner active invocation stale window must be at least "
      + `${ACTIVE_INVOCATION_HEARTBEAT_STALE_MIN_MULTIPLIER}x the heartbeat interval plus touch timeout.`,
    );
  }
}

assertHostedRunnerLivenessTimingInvariant();
