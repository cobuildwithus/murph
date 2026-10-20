import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionCodexAuthRequestedWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";

const mocks = vi.hoisted(() => ({
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  prepareHostedWakeContext: vi.fn(),
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
  sendAssistantNotification: vi.fn(),
  startAssistantOnboarding: vi.fn(),
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
    startAssistantOnboarding: mocks.startAssistantOnboarding,
  };
});

vi.mock("../src/hosted-runtime/device-sync-maintenance-import.ts", () => ({
  isHostedDeviceSyncMaintenanceModuleLoadError: vi.fn(() => false),
  loadHostedDeviceSyncMaintenanceModule: vi.fn(async () => ({
    runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
  })),
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
      nextWakeReason: null,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
  });

  it("runs the device-sync runtime lane for device-sync wakes", async () => {
    const runtime = createRuntime();
    const signal = new AbortController().signal;
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
        runtimeLogContext: {
          attemptId: "attempt_device_sync_event",
          leaseGeneration: "11",
          workspaceVersion: "12",
        },
        runtimeEnv: {},
        signal,
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
      retainFollowUpWakeUntilCheckpoint: true,
      runtimeLogContext: {
        attemptId: "attempt_device_sync_event",
        leaseGeneration: "11",
        workspaceVersion: "12",
      },
      runtimeLogPlatform: runtime.platform,
      resolvedConfig: runtime.resolvedConfig,
      signal,
      timeoutMs: 300_000,
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
      wake: deviceSyncWake,
    });
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      {
        signal,
        vault: "/tmp/assistant-runtime-events-coverage",
      },
    );
  });

  it("passes foreground-yield and abort signals to device-sync wake handling", async () => {
    const runtime = createRuntime();
    const shouldYieldDeviceSync = vi.fn(() => true);
    const signal = new AbortController().signal;
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
      signal,
      shouldYieldBackgroundMaintenance: shouldYieldDeviceSync,
      vaultRoot: "/tmp/assistant-runtime-events-coverage-yield",
    });

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldDeviceSync,
        signal,
      }),
    );
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).not.toHaveBeenCalled();
  });

  it("does not schedule device activity automation after device-sync yields", async () => {
    const runtime = createRuntime();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_skipped",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-08T00:10:30.000Z",
      parserProcessed: 0,
    });

    await executeHostedMailboxEvent({
      wake: deviceSyncWake,
      executionContext,
      runtime,
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events-coverage-skipped",
    });

    expect(mocks.scheduleDeviceActivityTriggeredAutomations).not.toHaveBeenCalled();
  });

  it("does not schedule device activity automation after invocation aborts", async () => {
    const runtime = createRuntime();
    const controller = new AbortController();
    controller.abort();
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_wake_aborted",
      occurredAt: "2026-04-08T00:10:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });

    await executeHostedMailboxEvent({
      wake: deviceSyncWake,
      executionContext,
      runtime,
      runtimeEnv: {},
      signal: controller.signal,
      vaultRoot: "/tmp/assistant-runtime-events-coverage-aborted",
    });

    expect(mocks.scheduleDeviceActivityTriggeredAutomations).not.toHaveBeenCalled();
  });

  it("returns an assistant wake when device activity automation schedules notification work", async () => {
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

  it.each(["connect", "disconnect"] as const)(
    "retires legacy Codex auth %s wakes by deleting local credentials",
    async (action) => {
      const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "murph-codex-auth-retired-"));
      const authPath = path.join(operatorHomeRoot, ".codex-hosted", "auth.json");
      const wake = buildHostedExecutionCodexAuthRequestedWake({
        action,
        attemptId: "hca_retiredattempt",
        eventId: "runtime-control:codex-auth-retired",
        occurredAt: "2026-04-08T00:15:00.000Z",
        userId: "member_123",
      });
      try {
        await mkdir(path.dirname(authPath), { recursive: true });
        await writeFile(authPath, '{"auth_mode":"chatgpt"}\n');
        const input = {
          executionContext,
          operatorHomeRoot,
          runtime: createRuntime(),
          runtimeEnv: {},
          vaultRoot: "/tmp/assistant-runtime-events-coverage",
          wake,
        };
        await expect(executeHostedMailboxEvent(input)).resolves.toMatchObject({
          mailboxLane: "runtime-control",
          postCheckpointRecord: null,
        });
        await expect(access(authPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(executeHostedMailboxEvent(input)).resolves.toMatchObject({
          mailboxLane: "runtime-control",
          postCheckpointRecord: null,
        });
      } finally {
        await rm(operatorHomeRoot, { force: true, recursive: true });
      }
    },
  );

  it("does not finish a retired auth wake without an operator home root", async () => {
    await expect(executeHostedMailboxEvent({
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events-coverage",
      wake: buildHostedExecutionCodexAuthRequestedWake({
        action: "disconnect",
        attemptId: "hca_retiredattempt",
        eventId: "runtime-control:codex-auth-retired",
        occurredAt: "2026-04-08T00:15:00.000Z",
        userId: "member_123",
      }),
    })).rejects.toThrow("Hosted Codex auth cleanup requires an operator home root.");
  });

  it("does not finish a retired auth wake when local credential deletion fails", async () => {
    const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "murph-codex-auth-retired-"));
    const authPath = path.join(operatorHomeRoot, ".codex-hosted", "auth.json");
    try {
      await mkdir(authPath, { recursive: true });
      await expect(executeHostedMailboxEvent({
        executionContext,
        operatorHomeRoot,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events-coverage",
        wake: buildHostedExecutionCodexAuthRequestedWake({
          action: "connect",
          attemptId: "hca_retiredattempt",
          eventId: "runtime-control:codex-auth-retired",
          occurredAt: "2026-04-08T00:15:00.000Z",
          userId: "member_123",
        }),
      })).rejects.toThrow();
      await expect(access(authPath)).resolves.toBeUndefined();
    } finally {
      await rm(operatorHomeRoot, { force: true, recursive: true });
    }
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
