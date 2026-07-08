import assert from "node:assert/strict";

import { afterEach, expect, test, vi } from "vitest";

import type {
  HostedDeviceSyncMaintenanceModule,
} from "../src/hosted-runtime/device-sync-maintenance-import.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const DEVICE_SYNC_MAINTENANCE_MODULE_PATH =
  "../src/hosted-runtime/device-sync-maintenance.ts";

type DeviceSyncMaintenanceLaneModule = Pick<
  HostedDeviceSyncMaintenanceModule,
  "runHostedDeviceSyncWakeLane"
>;

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
  sendAssistantNotification: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext: mocks.prepareHostedWakeContext,
}));

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );

  return {
    ...actual,
    scheduleDeviceActivityTriggeredAutomations:
      mocks.scheduleDeviceActivityTriggeredAutomations,
    sendAssistantNotification: mocks.sendAssistantNotification,
  };
});

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

afterEach(() => {
  vi.doUnmock(DEVICE_SYNC_MAINTENANCE_MODULE_PATH);
  vi.resetModules();
  vi.clearAllMocks();
});

test("device-sync maintenance import is lazy, reports load failures, and retries after rejection", async () => {
  vi.resetModules();
  const failedModuleLoad = createDeferred<DeviceSyncMaintenanceLaneModule>();
  const successfulModuleLoad = createDeferred<DeviceSyncMaintenanceLaneModule>();
  const moduleLoads = [failedModuleLoad, successfulModuleLoad];
  let moduleLoadCount = 0;
  const runHostedDeviceSyncWakeLane =
    vi.fn<DeviceSyncMaintenanceLaneModule["runHostedDeviceSyncWakeLane"]>(
      async () => ({
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        nextWakeAt: "2026-04-26T00:15:00.000Z",
        parserProcessed: 0,
        postCheckpointRecord: null,
      }),
    );

  vi.doMock(DEVICE_SYNC_MAINTENANCE_MODULE_PATH, async () => {
    const moduleLoad = moduleLoads[moduleLoadCount];
    moduleLoadCount += 1;
    if (!moduleLoad) {
      throw new Error("Unexpected extra device-sync maintenance module import.");
    }
    return await moduleLoad.promise;
  });

  const { executeHostedMailboxEvent } = await import("../src/hosted-runtime/events.ts");
  const {
    buildHostedExecutionDeviceSyncWake,
  } = await import("@murphai/hosted-execution");

  assert.equal(moduleLoadCount, 0);
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.prepareHostedWakeContext.mockResolvedValue(null);
  mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValue({
    matched: 0,
    nextWakeAt: null,
    scheduled: 0,
  });

  const firstWake = executeHostedMailboxEvent({
    wake: buildHostedExecutionDeviceSyncWake({
      eventId: "evt_device_sync_lazy_failure",
      occurredAt: "2026-04-26T00:00:00.000Z",
      reason: "reconcile_due",
      userId: "member_device_sync_lazy",
    }),
    executionContext: createExecutionContext(),
    runtime: createRuntime(),
    runtimeEnv: {},
    vaultRoot: "/tmp/assistant-runtime-device-sync-loader",
  });
  await waitFor(() => moduleLoadCount === 1);
  failedModuleLoad.reject(new Error("synthetic device-sync maintenance module load failure"));

  const firstError = await firstWake.then(
    () => null,
    (error: unknown) => error,
  );
  if (!(firstError instanceof Error)) {
    throw new TypeError("Expected device-sync module load failure.");
  }
  assert.equal(firstError.name, "HostedDeviceSyncMaintenanceModuleLoadError");
  assert.equal(
    "code" in firstError ? firstError.code : null,
    "device-sync-maintenance-module-load-failed",
  );
  expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({
        eventCode: "device-sync.module_load_failed",
        moduleLoadError: true,
      }),
      level: "error",
      message: "Hosted device-sync wake failed to load the maintenance module.",
    }),
  );
  assert.equal(runHostedDeviceSyncWakeLane.mock.calls.length, 0);

  const secondWake = executeHostedMailboxEvent({
    wake: buildHostedExecutionDeviceSyncWake({
      eventId: "evt_device_sync_lazy_retry",
      occurredAt: "2026-04-26T00:01:00.000Z",
      reason: "reconcile_due",
      userId: "member_device_sync_lazy",
    }),
    executionContext: createExecutionContext(),
    runtime: createRuntime(),
    runtimeEnv: {},
    vaultRoot: "/tmp/assistant-runtime-device-sync-loader",
  });
  const concurrentWake = executeHostedMailboxEvent({
    wake: buildHostedExecutionDeviceSyncWake({
      eventId: "evt_device_sync_lazy_concurrent",
      occurredAt: "2026-04-26T00:02:00.000Z",
      reason: "reconcile_due",
      userId: "member_device_sync_lazy",
    }),
    executionContext: createExecutionContext(),
    runtime: createRuntime(),
    runtimeEnv: {},
    vaultRoot: "/tmp/assistant-runtime-device-sync-loader",
  });
  await waitFor(() => moduleLoadCount === 2);
  successfulModuleLoad.resolve({
    runHostedDeviceSyncWakeLane,
  });

  const [secondOutcome, concurrentOutcome] = await Promise.all([
    secondWake,
    concurrentWake,
  ]);
  assert.equal(secondOutcome.mailboxLane, "device-sync");
  assert.equal(concurrentOutcome.mailboxLane, "device-sync");
  assert.equal(moduleLoadCount, 2);
  assert.equal(runHostedDeviceSyncWakeLane.mock.calls.length, 2);

  const memoizedOutcome = await executeHostedMailboxEvent({
    wake: buildHostedExecutionDeviceSyncWake({
      eventId: "evt_device_sync_lazy_memoized",
      occurredAt: "2026-04-26T00:03:00.000Z",
      reason: "reconcile_due",
      userId: "member_device_sync_lazy",
    }),
    executionContext: createExecutionContext(),
    runtime: createRuntime(),
    runtimeEnv: {},
    vaultRoot: "/tmp/assistant-runtime-device-sync-loader",
  });
  assert.equal(memoizedOutcome.mailboxLane, "device-sync");
  assert.equal(moduleLoadCount, 2);
  assert.equal(runHostedDeviceSyncWakeLane.mock.calls.length, 3);
});

function createExecutionContext() {
  return {
    hosted: {
      memberId: "member_device_sync_lazy",
      userEnvKeys: [],
    },
  } as const;
}

function createRuntime(
  platformOverrides: Partial<HostedRuntimePlatform> = {},
) {
  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort: null,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageRecordPort: null,
      ...platformOverrides,
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  } as const;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
} {
  let rejectDeferred: ((reason: unknown) => void) | null = null;
  let resolveDeferred: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    rejectDeferred = reject;
    resolveDeferred = resolve;
  });
  return {
    promise,
    reject(reason) {
      rejectDeferred?.(reason);
    },
    resolve(value) {
      resolveDeferred?.(value);
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error("Timed out waiting for expected test state.");
}
