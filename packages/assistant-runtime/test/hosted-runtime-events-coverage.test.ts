import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
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
