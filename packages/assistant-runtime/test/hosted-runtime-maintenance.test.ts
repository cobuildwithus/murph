import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAssistantFoodAutoLogHooks: vi.fn(),
  createConfiguredDeviceSyncProvidersFromConfigs: vi.fn(),
  createConfiguredParserRegistry: vi.fn(),
  createDeviceSyncRegistry: vi.fn(),
  createDeviceSyncService: vi.fn(),
  createInboxParserService: vi.fn(),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  openInboxRuntime: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readHostedAssistantRuntimeState: vi.fn(),
  rebuildRuntimeFromVault: vi.fn(),
  reconcileHostedDeviceSyncControlPlaneState: vi.fn(),
  runAssistantAutomationPass: vi.fn(),
  syncHostedDeviceSyncControlPlaneState: vi.fn(),
}));

vi.mock("@murphai/device-syncd/config", () => ({
  createConfiguredDeviceSyncProvidersFromConfigs:
    mocks.createConfiguredDeviceSyncProvidersFromConfigs,
}));

vi.mock("@murphai/device-syncd/registry", () => ({
  createDeviceSyncRegistry: mocks.createDeviceSyncRegistry,
}));

vi.mock("@murphai/device-syncd/service", () => ({
  createDeviceSyncService: mocks.createDeviceSyncService,
}));

vi.mock("@murphai/inboxd/runtime", () => ({
  openInboxRuntime: mocks.openInboxRuntime,
  rebuildRuntimeFromVault: mocks.rebuildRuntimeFromVault,
}));

vi.mock("@murphai/parsers", () => ({
  createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
  createInboxParserService: mocks.createInboxParserService,
}));

vi.mock("@murphai/assistant-engine", () => ({
  createAssistantFoodAutoLogHooks: mocks.createAssistantFoodAutoLogHooks,
  readAssistantAutomationState: mocks.readAssistantAutomationState,
  runAssistantAutomationPass: mocks.runAssistantAutomationPass,
}));

vi.mock("@murphai/inbox-services", () => ({
  createIntegratedInboxServices: mocks.createIntegratedInboxServices,
}));

vi.mock("@murphai/vault-usecases/vault-services", () => ({
  createIntegratedVaultServices: mocks.createIntegratedVaultServices,
}));

vi.mock("../src/hosted-device-sync-runtime.ts", () => ({
  reconcileHostedDeviceSyncControlPlaneState:
    mocks.reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState: mocks.syncHostedDeviceSyncControlPlaneState,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  readHostedAssistantRuntimeState: mocks.readHostedAssistantRuntimeState,
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  drainHostedParserQueue,
  drainHostedParserQueueUntilSettled,
  runHostedAssistantAutomation,
  runHostedAssistantCronWakeLane,
  runHostedConversationAssistantAutomation,
  runHostedDeviceSyncPass,
  runHostedDeviceSyncWakeLane,
  runHostedNoopSystemWakeLane,
} from "../src/hosted-runtime/maintenance.ts";

const DEVICE_SYNC_CONFIG = {
  providerConfigs: {
    oura: {
      clientId: "oura-client",
      clientSecret: "oura-secret",
    },
  },
  publicBaseUrl: "https://device-sync.example.test",
  secret: "secret_123",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createConfiguredParserRegistry.mockResolvedValue({
    ffmpeg: Symbol("ffmpeg"),
    registry: Symbol("parser-registry"),
  });
  mocks.createInboxParserService.mockReturnValue({
    drain: vi.fn(async () => []),
  });
  mocks.createIntegratedInboxServices.mockReturnValue(Symbol("inbox-services"));
  mocks.createAssistantFoodAutoLogHooks.mockReturnValue(Symbol("food-auto-log-hooks"));
  mocks.createIntegratedVaultServices.mockReturnValue(Symbol("vault-services"));
  mocks.readHostedAssistantRuntimeState.mockResolvedValue({
    assistantActiveProfileId: null,
    assistantActiveProfileManagedBy: null,
    assistantActiveProfileReady: false,
    assistantConfigInvalid: false,
    assistantConfigPresent: true,
    assistantConfigStatus: "saved",
    assistantConfigured: true,
    assistantProvider: "openai-compatible",
  });
  mocks.readAssistantAutomationState.mockResolvedValue({
    autoReply: [],
    inboxScanCursor: null,
    updatedAt: "2026-04-08T00:00:00.000Z",
    version: 1,
  });
  mocks.runAssistantAutomationPass.mockResolvedValue({
    nextWakeAt: "2026-04-08T01:00:00.000Z",
    progressed: false,
  });
  mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue(["oura"]);
  mocks.createDeviceSyncRegistry.mockReturnValue({
    list: () => ["oura"],
  });
  mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValue({
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    snapshot: {
      connections: [],
      schema: "murph.hosted-device-sync-runtime-snapshot.v1",
    },
  });
  mocks.reconcileHostedDeviceSyncControlPlaneState.mockResolvedValue(undefined);
});

describe("drainHostedParserQueue", () => {
  it("hydrates unique pending artifact paths before draining the parser queue", async () => {
    const close = vi.fn();
    const drain = vi.fn(async () => [{ id: "job_1" }, { id: "job_2" }]);
    const artifactMaterializer = vi.fn(async () => undefined);

    mocks.openInboxRuntime.mockResolvedValue({
      close,
      getCapture: (captureId: string) => (
        captureId === "capture_1"
          ? {
              attachments: [
                {
                  attachmentId: "attachment_1",
                  storedPath: "vault/raw/a.bin",
                },
              ],
            }
          : {
              attachments: [
                {
                  attachmentId: "attachment_2",
                  storedPath: "vault/raw/a.bin",
                },
                {
                  attachmentId: "attachment_3",
                  storedPath: "vault/raw/b.bin",
                },
              ],
            }
      ),
      listAttachmentParseJobs: () => [
        {
          attachmentId: "attachment_1",
          captureId: "capture_1",
        },
        {
          attachmentId: "attachment_2",
          captureId: "capture_2",
        },
        {
          attachmentId: "attachment_3",
          captureId: "capture_2",
        },
      ],
    });
    mocks.createInboxParserService.mockReturnValue({
      drain,
    });

    const result = await drainHostedParserQueue({
      artifactMaterializer,
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toEqual({
      nextWakeAt: null,
      processedJobs: 2,
    });
    expect(mocks.rebuildRuntimeFromVault).toHaveBeenCalledWith({
      runtime: expect.any(Object),
      vaultRoot: "/tmp/vault-root",
    });
    expect(artifactMaterializer).toHaveBeenCalledWith([
      "vault/raw/a.bin",
      "vault/raw/b.bin",
    ]);
    expect(drain).toHaveBeenCalledWith({
      maxJobs: 50,
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("drainHostedParserQueueUntilSettled", () => {
  it("keeps draining parser work until the queue settles", async () => {
    const close = vi.fn();
    const drain = vi
      .fn()
      .mockResolvedValueOnce([{ id: "job_1" }])
      .mockResolvedValueOnce([]);

    mocks.openInboxRuntime.mockResolvedValue({
      close,
      getCapture: vi.fn(() => null),
      listAttachmentParseJobs: vi.fn(() => []),
    });
    mocks.createInboxParserService.mockReturnValue({
      drain,
    });

    await expect(
      drainHostedParserQueueUntilSettled({
        vaultRoot: "/tmp/vault-root",
      }),
    ).resolves.toEqual({
      nextWakeAt: null,
      processedJobs: 1,
    });

    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("schedules an immediate follow-up wake when parser work never settles within the cap", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      const close = vi.fn();
      const drain = vi.fn(async () => [{ id: "job_1" }]);

      mocks.openInboxRuntime.mockResolvedValue({
        close,
        getCapture: vi.fn(() => null),
        listAttachmentParseJobs: vi.fn(() => []),
      });
      mocks.createInboxParserService.mockReturnValue({
        drain,
      });

      const result = await drainHostedParserQueueUntilSettled({
        vaultRoot: "/tmp/vault-root",
      });

      expect(result.processedJobs).toBe(10);
      expect(result.nextWakeAt).toBe("2026-04-08T00:00:00.000Z");
      expect(drain).toHaveBeenCalledTimes(10);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runHostedAssistantAutomation", () => {
  it("logs automation events emitted during the hosted pass", async () => {
    mocks.readAssistantAutomationState
      .mockResolvedValueOnce({
        autoReply: [],
        inboxScanCursor: null,
        updatedAt: "2026-04-08T00:00:00.000Z",
        version: 1,
      })
      .mockResolvedValueOnce({
        autoReply: [
          {
            channel: "telegram",
            cursor: {
              captureId: "capture_123",
              importedAt: "2026-04-08T00:10:00.000Z",
            },
          },
        ],
        inboxScanCursor: {
          captureId: "capture_123",
          importedAt: "2026-04-08T00:10:00.000Z",
        },
        updatedAt: "2026-04-08T00:10:00.000Z",
        version: 2,
      });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onEvent?.({
        captureId: "capture_123",
        details: "reply sent",
        type: "capture.replied",
      });
      return {
        nextWakeAt: "2026-04-08T01:15:00.000Z",
        progressed: true,
      };
    });

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_123",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_event",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        },
      ),
    ).resolves.toEqual({
      nextWakeAt: "2026-04-08T01:15:00.000Z",
      progressed: true,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          captureId: "capture_123",
          details: "reply sent",
          type: "capture.replied",
        }),
        message: "Hosted assistant automation event: capture.replied.",
      }),
    );
  });

  it("treats missing inbox runtime state as a non-fatal bootstrap gap", async () => {
    mocks.runAssistantAutomationPass.mockRejectedValueOnce({
      code: "INBOX_NOT_INITIALIZED",
    });

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_123",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_gap",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        },
      ),
    ).resolves.toEqual({
      nextWakeAt: null,
      progressed: false,
    });
  });

  it("rethrows unexpected automation failures", async () => {
    mocks.runAssistantAutomationPass.mockRejectedValueOnce(new Error("automation failed"));

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_123",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_failure",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        },
      ),
    ).rejects.toThrow("automation failed");
  });
});

describe("runHostedConversationAssistantAutomation", () => {
  it("returns the hosted assistant skip path when the runtime is not ready", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantActiveProfileId: "platform-default",
      assistantActiveProfileManagedBy: "platform",
      assistantActiveProfileReady: false,
      assistantConfigInvalid: false,
      assistantConfigPresent: true,
      assistantConfigStatus: "hosted-env",
      assistantConfigured: false,
      assistantProvider: "openai-compatible",
    });

    await expect(
      runHostedConversationAssistantAutomation({
        executionContext: {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        requestId: "req_123",
        vaultRoot: "/tmp/vault-root",
        wake: {
          eventId: "evt_conversation_skip",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        },
      }),
    ).resolves.toEqual({
      nextWakeAt: null,
      progressed: false,
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because the active hosted assistant profile (openai-compatible) is not ready.",
      }),
    );
  });

  it("delegates to hosted assistant automation when the runtime is ready", async () => {
    await expect(
      runHostedConversationAssistantAutomation({
        executionContext: {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        requestId: "req_123",
        vaultRoot: "/tmp/vault-root",
        wake: {
          eventId: "evt_conversation_ready",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        },
      }),
    ).resolves.toEqual({
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      progressed: false,
    });

    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
  });
});

describe("runHostedDeviceSyncPass", () => {
  it("skips device sync entirely when no providers are configured", async () => {
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_skip",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      "/tmp/vault-root",
      null,
      null,
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.createDeviceSyncService).not.toHaveBeenCalled();
  });

  it("skips device sync when the resolved registry has no providers", async () => {
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_empty_registry",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      null,
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.createDeviceSyncService).not.toHaveBeenCalled();
  });

  it("skips device sync when the hosted runtime resolved config disables device sync", async () => {
    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_missing_env",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      "/tmp/vault-root",
      null,
      null,
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.createDeviceSyncService).not.toHaveBeenCalled();
  });

  it("logs non-fatal control-plane sync failures for non-device-sync wake events and keeps processing jobs", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 3);

    mocks.createDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("sync failed"),
    );

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_continue",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      {
        applyUpdates: vi.fn(),
        createConnectLink: vi.fn(),
        fetchSnapshot: vi.fn(),
      },
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T02:00:00.000Z",
      processedJobs: 3,
      skipped: false,
    });
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted device-sync control-plane sync failed; continuing hosted job.",
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("logs non-fatal control-plane reconcile failures for non-device-sync wake events and keeps processing jobs", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 3);

    mocks.createDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      runSchedulerOnce,
    });
    mocks.reconcileHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("reconcile failed"),
    );

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_reconcile_continue",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      {
        applyUpdates: vi.fn(),
        createConnectLink: vi.fn(),
        fetchSnapshot: vi.fn(),
      },
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T02:00:00.000Z",
      processedJobs: 3,
      skipped: false,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted device-sync control-plane reconcile failed; continuing hosted job.",
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed on control-plane sync errors during device-sync wake handling", async () => {
    const close = vi.fn();

    mocks.createDeviceSyncService.mockReturnValue({
      close,
      drainWorker: vi.fn(),
      getNextWakeAt: () => null,
      runSchedulerOnce: vi.fn(),
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("sync failed"),
    );

    await expect(
      runHostedDeviceSyncPass(
        {
          eventId: "evt_wake",
          hint: null,
          kind: "device-sync.wake",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "webhook_hint",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        {
          applyUpdates: vi.fn(),
          createConnectLink: vi.fn(),
          fetchSnapshot: vi.fn(),
        },
        45_000,
      ),
    ).rejects.toThrow("sync failed");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed on control-plane reconcile errors during device-sync wake handling", async () => {
    const close = vi.fn();

    mocks.createDeviceSyncService.mockReturnValue({
      close,
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => null,
      runSchedulerOnce: vi.fn(async () => undefined),
    });
    mocks.reconcileHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("reconcile failed"),
    );

    await expect(
      runHostedDeviceSyncPass(
        {
          eventId: "evt_wake_reconcile",
          hint: null,
          kind: "device-sync.wake",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "webhook_hint",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        {
          applyUpdates: vi.fn(),
          createConnectLink: vi.fn(),
          fetchSnapshot: vi.fn(),
        },
        45_000,
      ),
    ).rejects.toThrow("reconcile failed");

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("runHostedAssistantCronWakeLane", () => {
  it("runs assistant automation without sweeping parser or device-sync work", async () => {
    const result = await runHostedAssistantCronWakeLane({
      wake: {
        eventId: "evt_assistant_lane",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      parserProcessed: 0,
      wakeMaterializationHints: null,
    });
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      executionContext: {
        hosted: {
          issueDeviceConnectLink: expect.any(Function),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      inboxServices: expect.anything(),
      onEvent: expect.any(Function),
      requestId: "req_123",
      vault: "/tmp/vault-root",
      vaultServices: expect.anything(),
    });
    expect(mocks.openInboxRuntime).not.toHaveBeenCalled();
    expect(mocks.createDeviceSyncService).not.toHaveBeenCalled();
  });

  it("returns an immediate follow-up wake when assistant work is still runnable now", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runAssistantAutomationPass.mockResolvedValueOnce({
        nextWakeAt: null,
        progressed: true,
      });

      const result = await runHostedAssistantCronWakeLane({
        wake: {
          eventId: "evt_assistant_progress",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        },
        executionContext: {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        requestId: "req_123",
        vaultRoot: "/tmp/vault-root",
      });

      assert.deepEqual(result, {
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        parserProcessed: 0,
        wakeMaterializationHints: null,
      });
      expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips assistant automation without warning when the caller explicitly disables it", async () => {
    const result = await runHostedAssistantCronWakeLane({
      wake: {
        eventId: "evt_skip_requested",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      skipAssistantAutomation: true,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      wakeMaterializationHints: null,
    });
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("logs skipped automation when the hosted assistant is not configured", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
    });

    const result = await runHostedAssistantCronWakeLane({
      wake: {
        eventId: "evt_skip_automation",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      wakeMaterializationHints: null,
    });
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because no explicit hosted assistant profile is configured.",
      }),
    );
  });

  it("reports invalid hosted assistant configs when automation is skipped", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantActiveProfileId: null,
      assistantActiveProfileManagedBy: null,
      assistantActiveProfileReady: false,
      assistantConfigInvalid: true,
      assistantConfigPresent: false,
      assistantConfigStatus: "invalid",
      assistantConfigured: false,
      assistantProvider: null,
    });

    await runHostedAssistantCronWakeLane({
      wake: {
        eventId: "evt_invalid_automation",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because the saved hosted assistant config is invalid.",
      }),
    );
  });

  it("reports unready hosted assistant profiles with the active provider label", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantActiveProfileId: "platform-default",
      assistantActiveProfileManagedBy: "platform",
      assistantActiveProfileReady: false,
      assistantConfigInvalid: false,
      assistantConfigPresent: true,
      assistantConfigStatus: "hosted-env",
      assistantConfigured: false,
      assistantProvider: "openai-compatible",
    });

    await runHostedAssistantCronWakeLane({
      wake: {
        eventId: "evt_unready_automation",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because the active hosted assistant profile (openai-compatible) is not ready.",
      }),
    );
  });
});

describe("runHostedDeviceSyncWakeLane", () => {
  it("runs only the hosted device-sync lane", async () => {
    mocks.createDeviceSyncService.mockReturnValue({
      close: vi.fn(),
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => "2026-04-08T00:30:00.000Z",
      runSchedulerOnce: vi.fn(async () => undefined),
    });

    const result = await runHostedDeviceSyncWakeLane({
      deviceSyncPort: {
        applyUpdates: vi.fn(),
        createConnectLink: vi.fn(),
        fetchSnapshot: vi.fn(),
      },
      wake: {
        eventId: "evt_device_sync_lane",
        kind: "device-sync.wake",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "connected",
        userId: "member_123",
      },
      resolvedConfig: {
        deviceSync: DEVICE_SYNC_CONFIG,
      },
      timeoutMs: 45_000,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:30:00.000Z",
      parserProcessed: 0,
      wakeMaterializationHints: null,
    });
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.openInboxRuntime).not.toHaveBeenCalled();
  });
});

describe("runHostedNoopSystemWakeLane", () => {
  it("returns an empty follow-up result for explicit no-op system wakes", () => {
    assert.deepEqual(runHostedNoopSystemWakeLane(), {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      wakeMaterializationHints: null,
    });
  });
});
