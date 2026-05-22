import {
  proxyActivities,
} from "@temporalio/workflow";

import type * as activities from "../activities/index.js";
import type {
  HostedDeviceSyncRecoverySweepResult,
} from "../activities/index.js";
import type {
  HostedDeviceSyncReconcilerWorkflowInput,
  HostedDeviceSyncReconcilerWorkflowOptions,
} from "../workflow-types.js";
import {
  HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
  HOSTED_DEVICE_SYNC_RECONCILER_MAX_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
  HOSTED_DEVICE_SYNC_RECONCILER_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
} from "../workflow-types.js";

export async function hostedDeviceSyncReconcilerWorkflow(
  input: HostedDeviceSyncReconcilerWorkflowInput = {},
): Promise<HostedDeviceSyncRecoverySweepResult> {
  const options = normalizeHostedDeviceSyncReconcilerWorkflowOptions(
    input.options,
  );
  const recoveryActivities = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "5 seconds",
      maximumAttempts: 3,
      maximumInterval: "1 minute",
    },
    startToCloseTimeout: options.recoverySweepStartToCloseTimeoutMs,
  });

  return recoveryActivities.runHostedDeviceSyncRecoverySweep();
}

export function normalizeHostedDeviceSyncReconcilerWorkflowOptions(
  options: HostedDeviceSyncReconcilerWorkflowOptions | null | undefined,
): Required<HostedDeviceSyncReconcilerWorkflowOptions> {
  return {
    recoverySweepStartToCloseTimeoutMs: normalizeBoundedInteger(
      options?.recoverySweepStartToCloseTimeoutMs,
      HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_MAX_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
    ),
  };
}

function normalizeBoundedInteger(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(Math.floor(value), max));
}
