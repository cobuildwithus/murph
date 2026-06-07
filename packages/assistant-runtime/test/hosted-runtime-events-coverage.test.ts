import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
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
    scheduleDeviceActivityTriggeredAutomations: mocks.scheduleDeviceActivityTriggeredAutomations,
    sendAssistantNotification: mocks.sendAssistantNotification,
  };
});

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
}));

import { executeHostedMailboxEvent } from "../src/hosted-runtime/events.ts";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const executionContext = {
  hosted: {
    memberId: "member_123",
    userEnvKeys: [],
  },
} as const;

function createRuntime() {
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
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.prepareHostedWakeContext.mockResolvedValue(null);
  mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValue({
    matched: 0,
    nextWakeAt: null,
    scheduled: 0,
  });
  mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
    deviceSyncProcessed: 1,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:20:00.000Z",
    parserProcessed: 0,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("hosted runtime event coverage", () => {
  it("treats activation wakes as a noop ingress lane", async () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "evt_member_activated",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const result = await executeHostedMailboxEvent({
      wake,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
    });

    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
    assert.deepEqual(result, {
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "member-activated",
      nextWakeAt: null,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
  });

  it("runs the device-sync runtime lane for device-sync wakes", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toEqual({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith({
      deviceSyncPort: null,
      platformEnv: {},
      runtimeLogPlatform: runtime.platform,
      resolvedConfig: runtime.resolvedConfig,
      timeoutMs: null,
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
      wake: deviceSyncWake,
    });
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/assistant-runtime-events-coverage",
      }),
    );
  });

  it("passes foreground-yield hooks to device-sync wake handling", async () => {
    const runtime = createRuntime();
    const shouldYieldDeviceSync = vi.fn(() => true);
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_yield",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });

    await executeHostedMailboxEvent({
      wake: deviceSyncWake,
      executionContext,
      runtime,
      runtimeEnv: {},
      shouldYieldDeviceSync,
      vaultRoot: "/tmp/assistant-runtime-events-coverage-yield",
    });

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldDeviceSync,
      }),
    );
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).not.toHaveBeenCalled();
  });

  it("returns an assistant wake when a device activity automation schedules notification work", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_activity",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      parserProcessed: 0,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 1,
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      scheduled: 1,
    });

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toMatchObject({
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      nextWakeReason: "assistant",
      postCheckpointRecord: null,
    });
  });

  it("returns an assistant wake when a device activity automation handoff is already due", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_activity_due",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      parserProcessed: 0,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 0,
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      scheduled: 0,
    });

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toMatchObject({
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:10:05.000Z",
      nextWakeReason: "assistant",
      postCheckpointRecord: null,
    });
  });

  it("does not fail the device-sync wake when device activity automation scheduling fails", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_activity_failure",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "conn_123",
        kind: "device-sync.dirty-processed",
        processedRevision: "rev_123",
      },
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockRejectedValueOnce(
      new Error("automation handoff unavailable"),
    );

    await expect(
      executeHostedMailboxEvent({
        wake: deviceSyncWake,
        executionContext,
        runtime,
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).resolves.toMatchObject({
      mailboxLane: "device-sync",
      nextWakeAt: "2026-04-08T00:20:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      postCheckpointRecord: {
        connectionId: "conn_123",
        kind: "device-sync.dirty-processed",
        processedRevision: "rev_123",
      },
    });
  });

  it("fails closed on unexpected wake kinds", async () => {
    await expect(
      executeHostedMailboxEvent({
        wake: {
          kind: "unexpected.event",
          eventId: "evt_unexpected",
          occurredAt: "2026-04-08T00:20:00.000Z",
          userId: "member_123",
        } as never,
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
      }),
    ).rejects.toThrow(/Unsupported hosted system wake kind\./u);
  });
});
