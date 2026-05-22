import { ScheduleAlreadyRunning } from "@temporalio/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "../src/index.js";
import {
  ensureHostedDeviceSyncReconcilerSchedule,
  readHostedDeviceSyncReconcilerScheduleConfig,
} from "../src/client/device-sync-reconciler-schedule.js";

const workflowMocks = vi.hoisted(() => ({
  proxyActivities: vi.fn(),
  runHostedDeviceSyncRecoverySweep: vi.fn(),
}));

vi.mock("@temporalio/workflow", () => ({
  proxyActivities: workflowMocks.proxyActivities,
}));

describe("hostedDeviceSyncReconcilerWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs one recovery sweep Activity and exits with count-only results", async () => {
    const summary = buildRecoverySweepResponse();
    workflowMocks.runHostedDeviceSyncRecoverySweep.mockResolvedValue(summary);
    workflowMocks.proxyActivities.mockReturnValue({
      runHostedDeviceSyncRecoverySweep:
        workflowMocks.runHostedDeviceSyncRecoverySweep,
    });
    const {
      hostedDeviceSyncReconcilerWorkflow,
    } = await import("../src/workflows/hosted-device-sync-reconciler.js");

    await expect(hostedDeviceSyncReconcilerWorkflow({
      options: {
        recoverySweepStartToCloseTimeoutMs: 45_000,
      },
    })).resolves.toEqual(summary);

    expect(workflowMocks.proxyActivities).toHaveBeenCalledWith({
      retry: {
        initialInterval: "5 seconds",
        maximumAttempts: 3,
        maximumInterval: "1 minute",
      },
      startToCloseTimeout: 45_000,
    });
    expect(workflowMocks.runHostedDeviceSyncRecoverySweep).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded default Activity timeout", async () => {
    workflowMocks.runHostedDeviceSyncRecoverySweep.mockResolvedValue(
      buildRecoverySweepResponse(),
    );
    workflowMocks.proxyActivities.mockReturnValue({
      runHostedDeviceSyncRecoverySweep:
        workflowMocks.runHostedDeviceSyncRecoverySweep,
    });
    const {
      hostedDeviceSyncReconcilerWorkflow,
    } = await import("../src/workflows/hosted-device-sync-reconciler.js");

    await hostedDeviceSyncReconcilerWorkflow({
      options: {
        recoverySweepStartToCloseTimeoutMs: 999_000,
      },
    });

    expect(workflowMocks.proxyActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        startToCloseTimeout: 300_000,
      }),
    );
  });
});

describe("hosted device-sync reconciler Temporal Schedule", () => {
  it("builds an enabled interval schedule for the global reconciler workflow", async () => {
    const config = readHostedDeviceSyncReconcilerScheduleConfig({
      HOSTED_DEVICE_SYNC_RECONCILER_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS: "45000",
      HOSTED_DEVICE_SYNC_RECONCILER_INTERVAL_MS: "120000",
      HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED: "true",
      HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ID: "device-sync-test",
      HOSTED_TEMPORAL_TASK_QUEUE: "hosted-test-queue",
    });
    const client = buildScheduleClient();

    await expect(ensureHostedDeviceSyncReconcilerSchedule({
      client,
      config,
    })).resolves.toEqual({
      created: true,
      scheduleId: "device-sync-test",
      updated: false,
    });

    expect(client.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          args: [{
            options: {
              recoverySweepStartToCloseTimeoutMs: 45_000,
            },
          }],
          taskQueue: "hosted-test-queue",
          type: "startWorkflow",
          workflowId: "device-sync-test:workflow",
          workflowType: HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE,
        }),
        policies: expect.objectContaining({
          overlap: "SKIP",
        }),
        scheduleId: "device-sync-test",
        spec: {
          intervals: [{
            every: 120_000,
          }],
        },
        state: expect.objectContaining({
          paused: false,
        }),
      }),
    );
  });

  it("updates an existing schedule instead of failing schedule ensure", async () => {
    const client = buildScheduleClient();
    client.schedule.create.mockRejectedValueOnce(
      new ScheduleAlreadyRunning("already exists", "device-sync-test"),
    );
    const config = readHostedDeviceSyncReconcilerScheduleConfig({
      HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED: "false",
      HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ID: "device-sync-test",
    });

    await expect(ensureHostedDeviceSyncReconcilerSchedule({
      client,
      config,
    })).resolves.toEqual({
      created: false,
      scheduleId: "device-sync-test",
      updated: true,
    });

    expect(client.schedule.getHandle).toHaveBeenCalledWith("device-sync-test");
    expect(client.updatedSchedules).toHaveLength(1);
    expect(client.updatedSchedules[0]).toMatchObject({
      action: {
        taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
        workflowType: HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE,
      },
      state: {
        paused: true,
      },
    });
  });

  it("rejects malformed feature flag and interval values", () => {
    expect(() => readHostedDeviceSyncReconcilerScheduleConfig({
      HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED: "sometimes",
    })).toThrow("HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED must be true or false.");

    expect(() => readHostedDeviceSyncReconcilerScheduleConfig({
      HOSTED_DEVICE_SYNC_RECONCILER_INTERVAL_MS: "60000ms",
    })).toThrow("HOSTED_DEVICE_SYNC_RECONCILER_INTERVAL_MS must be a positive integer.");
  });
});

function buildScheduleClient() {
  const updatedSchedules: unknown[] = [];
  const update = vi.fn(async (updateFn: (previous: unknown) => unknown) => {
    updatedSchedules.push(updateFn({}));
  });
  return {
    schedule: {
      create: vi.fn(async () => ({ scheduleId: "device-sync-test" })),
      getHandle: vi.fn(() => ({
        update,
      })),
    },
    updatedSchedules,
  };
}

function buildRecoverySweepResponse() {
  return {
    dueReconcileSweeper: {
      dueConnections: 2,
      skippedDueConnections: 0,
      wakeAppended: 1,
      wakeAttempted: 2,
      wakeDuplicate: 1,
      wakeFailed: 0,
      wakeLimit: 25,
      wakeNotAppended: 0,
    },
    sweeper: {
      dirtyConnections: 1,
      skippedDirtyConnections: 0,
      staleAfterMs: 30000,
      wakeAppended: 1,
      wakeAttempted: 1,
      wakeLimit: 25,
      wakeNotAppended: 0,
    },
  };
}
