import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
  type Client,
  type ScheduleOptions,
  type ScheduleUpdateOptions,
} from "@temporalio/client";

import {
  HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "../index.js";
import type {
  HostedDeviceSyncReconcilerWorkflowInput,
} from "../workflow-types.js";
import {
  HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
  HOSTED_DEVICE_SYNC_RECONCILER_MAX_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
  HOSTED_DEVICE_SYNC_RECONCILER_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
} from "../workflow-types.js";

export const HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_SCHEDULE_ID =
  "hosted-device-sync-reconciler";
export const HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_INTERVAL_MS = 60_000;
export const HOSTED_DEVICE_SYNC_RECONCILER_MAX_INTERVAL_MS = 3_600_000;
export const HOSTED_DEVICE_SYNC_RECONCILER_MIN_INTERVAL_MS = 10_000;

type EnvSource = Readonly<Record<string, string | undefined>>;
type HostedDeviceSyncReconcilerScheduleAction =
  ScheduleOptions["action"] & {
    type: "startWorkflow";
    args: [HostedDeviceSyncReconcilerWorkflowInput];
  };
type HostedDeviceSyncReconcilerScheduleOptions =
  ScheduleOptions<HostedDeviceSyncReconcilerScheduleAction>;
type HostedDeviceSyncReconcilerScheduleUpdateOptions =
  ScheduleUpdateOptions<HostedDeviceSyncReconcilerScheduleAction>;

export interface HostedDeviceSyncReconcilerScheduleConfig {
  activityStartToCloseTimeoutMs: number;
  enabled: boolean;
  intervalMs: number;
  scheduleId: string;
  taskQueue: string;
}

export interface HostedDeviceSyncReconcilerScheduleResult {
  created: boolean;
  scheduleId: string;
  updated: boolean;
}

export interface HostedDeviceSyncReconcilerScheduleClient {
  schedule: {
    create(
      schedule: HostedDeviceSyncReconcilerScheduleOptions,
    ): Promise<unknown>;
    getHandle(scheduleId: string): {
      update(
        updateFn: () => HostedDeviceSyncReconcilerScheduleUpdateOptions,
      ): Promise<void>;
    };
  };
}

export function readHostedDeviceSyncReconcilerScheduleConfig(
  source: EnvSource = process.env,
): HostedDeviceSyncReconcilerScheduleConfig {
  return {
    activityStartToCloseTimeoutMs: readBoundedPositiveInteger(
      source.HOSTED_DEVICE_SYNC_RECONCILER_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_MAX_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      "HOSTED_DEVICE_SYNC_RECONCILER_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS",
    ),
    enabled: readBoolean(
      source.HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED,
      true,
      "HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED",
    ),
    intervalMs: readBoundedPositiveInteger(
      source.HOSTED_DEVICE_SYNC_RECONCILER_INTERVAL_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_INTERVAL_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_MIN_INTERVAL_MS,
      HOSTED_DEVICE_SYNC_RECONCILER_MAX_INTERVAL_MS,
      "HOSTED_DEVICE_SYNC_RECONCILER_INTERVAL_MS",
    ),
    scheduleId: HOSTED_DEVICE_SYNC_RECONCILER_DEFAULT_SCHEDULE_ID,
    taskQueue: readOptionalString(source.HOSTED_TEMPORAL_TASK_QUEUE)
      ?? readOptionalString(source.TEMPORAL_TASK_QUEUE)
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
  };
}

export async function ensureHostedDeviceSyncReconcilerSchedule(input: {
  client: HostedDeviceSyncReconcilerScheduleClient;
  config: HostedDeviceSyncReconcilerScheduleConfig;
}): Promise<HostedDeviceSyncReconcilerScheduleResult> {
  const schedule = buildHostedDeviceSyncReconcilerScheduleOptions(input.config);

  try {
    await input.client.schedule.create(schedule);
    return {
      created: true,
      scheduleId: input.config.scheduleId,
      updated: false,
    };
  } catch (error) {
    if (!(error instanceof ScheduleAlreadyRunning)) {
      throw error;
    }
  }

  const handle = input.client.schedule.getHandle(input.config.scheduleId);
  await handle.update(() =>
    buildHostedDeviceSyncReconcilerScheduleUpdateOptions(input.config)
  );

  return {
    created: false,
    scheduleId: input.config.scheduleId,
    updated: true,
  };
}

function buildHostedDeviceSyncReconcilerScheduleOptions(
  config: HostedDeviceSyncReconcilerScheduleConfig,
): HostedDeviceSyncReconcilerScheduleOptions {
  return {
    action: buildHostedDeviceSyncReconcilerScheduleAction(config),
    memo: {
      owner: "hosted-orchestrator-temporal",
      purpose: "device-sync-scheduled-wake",
    },
    policies: {
      catchupWindow: "5 minutes",
      overlap: ScheduleOverlapPolicy.SKIP,
      pauseOnFailure: false,
    },
    scheduleId: config.scheduleId,
    spec: {
      intervals: [{
        every: config.intervalMs,
      }],
    },
    state: {
      paused: !config.enabled,
      note: config.enabled
        ? "Temporal-owned hosted device-sync scheduled wake sweep."
        : "Device-sync Temporal scheduled wake sweep disabled by feature flag.",
    },
  };
}

function buildHostedDeviceSyncReconcilerScheduleUpdateOptions(
  config: HostedDeviceSyncReconcilerScheduleConfig,
): HostedDeviceSyncReconcilerScheduleUpdateOptions {
  const options = buildHostedDeviceSyncReconcilerScheduleOptions(config);
  return {
    action: options.action,
    policies: options.policies,
    spec: options.spec,
    state: {
      note: options.state?.note,
      paused: options.state?.paused,
    },
  };
}

function buildHostedDeviceSyncReconcilerScheduleAction(
  config: HostedDeviceSyncReconcilerScheduleConfig,
): HostedDeviceSyncReconcilerScheduleAction {
  return {
    args: [{
      options: {
        recoverySweepStartToCloseTimeoutMs:
          config.activityStartToCloseTimeoutMs,
      },
    }],
    taskQueue: config.taskQueue,
    type: "startWorkflow",
    workflowId: `${config.scheduleId}:workflow`,
    workflowRunTimeout: "10 minutes",
    workflowType: HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE,
  };
}

function readOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readBoolean(
  value: string | null | undefined,
  fallback: boolean,
  label: string,
): boolean {
  const normalized = readOptionalString(value);
  if (normalized === null) {
    return fallback;
  }
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new TypeError(`${label} must be true or false.`);
}

function readBoundedPositiveInteger(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const normalized = readOptionalString(value);
  if (normalized === null) {
    return fallback;
  }
  if (!/^[0-9]+$/u.test(normalized)) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${label} must be between ${min} and ${max}.`);
  }

  return parsed;
}
