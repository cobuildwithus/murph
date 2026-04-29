import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeHostedRuntimeDeviceSyncService: vi.fn(),
  createInboxBackedAssistantTurnInputPort: vi.fn(),
  createConfiguredDeviceSyncProvidersFromConfigs: vi.fn(),
  createDeviceSyncRegistry: vi.fn(),
  createHostedRuntimeDeviceSyncService: vi.fn(),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  initInboxRuntime: vi.fn(),
  ingestHostedConversationMessageWake: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readHostedAssistantRuntimeState: vi.fn(),
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

vi.mock("../src/device-sync-service.ts", () => ({
  closeHostedRuntimeDeviceSyncService: mocks.closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService: mocks.createHostedRuntimeDeviceSyncService,
}));

vi.mock("@murphai/assistant-engine", () => ({
  HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA:
    "murph.assistant-context-diagnostics.v1",
  HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_TYPE: "assistant.context.diagnostics",
  createInboxBackedAssistantTurnInputPort: mocks.createInboxBackedAssistantTurnInputPort,
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

vi.mock("../src/hosted-runtime/events/conversation.ts", () => ({
  ingestHostedConversationMessageWake: mocks.ingestHostedConversationMessageWake,
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
  runHostedAssistantAutomation,
  runHostedAssistantRuntimeTimerLane,
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
  mocks.closeHostedRuntimeDeviceSyncService.mockImplementation((service: { close?: () => void }) => {
    service.close?.();
  });
  mocks.initInboxRuntime.mockResolvedValue({
    configPath: ".runtime/operations/inbox/config.json",
    createdPaths: [],
    databasePath: ".runtime/projections/inboxd.sqlite",
    rebuiltCaptures: 0,
    runtimeDirectory: ".runtime/operations/inbox",
    vault: "/tmp/vault-root",
  });
  mocks.createIntegratedInboxServices.mockReturnValue({
    init: mocks.initInboxRuntime,
  });
  mocks.createInboxBackedAssistantTurnInputPort.mockReturnValue({
    listNewConversationCaptures: vi.fn(async (query) => ({
      captures: [],
      nextCursor: query.afterCursor,
    })),
    refresh: vi.fn(async () => ({
      progressed: false,
      reason: "no_new_input",
    })),
  });
  mocks.createIntegratedVaultServices.mockReturnValue(Symbol("vault-services"));
  mocks.readHostedAssistantRuntimeState.mockResolvedValue({
    assistantActiveProfileId: null,
    assistantActiveProfileManagedBy: null,
    assistantActiveProfileReady: false,
    assistantConfigInvalid: false,
    assistantConfigPresent: true,
    assistantConfigStatus: "saved",
    assistantConfigured: true,
    assistantProvider: "codex-cli",
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
  mocks.ingestHostedConversationMessageWake.mockResolvedValue({
    nextWakeAt: null,
    parserProcessed: 0,
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

describe("runHostedAssistantAutomation", () => {
  it("wraps hosted mailbox refreshes through the local inbox-backed port", async () => {
    const checkpointActiveTurnInput = vi.fn(async () => undefined);
    const refreshMailboxForActiveTurnInput = vi.fn(async () => ({
      progressed: true,
      reason: "ingested_input" as const,
    }));
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      await input.turnInputPort?.refresh({
        phase: "request_boundary",
      });
      await input.turnInputPort?.checkpointAcceptedInput?.({
        acceptedInputIds: ["request-1"],
        providerRequestOrdinal: 0,
        sessionId: "session_123",
        turnId: "turn_123",
        vault: "/tmp/vault-root",
      });
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_turn_input",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_turn_input",
          kind: "runtime.timer",
          occurredAt: "2026-04-23T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        {
          forwardedEnv: {},
          platform: {
            artifactStore: {
              get: vi.fn(async () => null),
              put: vi.fn(async () => undefined),
            },
            effectsPort: {
              readRawEmailMessage: vi.fn(async () => null),
              sendEmail: vi.fn(async () => undefined),
            },
            checkpointActiveTurnInput,
            refreshMailboxForActiveTurnInput,
          },
          platformEnv: {},
        },
      ),
    ).resolves.toEqual({
      nextWakeAt: null,
      progressed: true,
      redactedLogEntries: expect.any(Array),
    });

    expect(refreshMailboxForActiveTurnInput).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
    expect(checkpointActiveTurnInput).toHaveBeenCalledWith({
      acceptedInputIds: ["request-1"],
      providerRequestOrdinal: 0,
      requestId: "req_turn_input",
      sessionId: "session_123",
      turnId: "turn_123",
      vault: "/tmp/vault-root",
    });
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith(
      expect.objectContaining({
        turnInputPort: expect.any(Object),
      }),
    );
    expect(mocks.initInboxRuntime).toHaveBeenCalledWith({
      rebuild: false,
      requestId: "req_turn_input",
      vault: "/tmp/vault-root",
    });
  });

  it("ensures the inbox runtime exists before hosted automation runs", async () => {
    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_bootstrap",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_bootstrap",
          kind: "runtime.timer",
          occurredAt: "2026-04-29T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      ),
    ).resolves.toEqual({
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      progressed: false,
      redactedLogEntries: expect.any(Array),
    });

    expect(mocks.initInboxRuntime).toHaveBeenCalledWith({
      rebuild: false,
      requestId: "req_bootstrap",
      vault: "/tmp/vault-root",
    });
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
  });

  it("logs automation events emitted during the hosted pass", async () => {
    mocks.readAssistantAutomationState
      .mockResolvedValueOnce({
        autoReply: [
          {
            channel: "telegram",
            enabledAt: "2026-04-08T00:00:00.000Z",
            eligibleAfter: {
              captureId: "capture_122",
              occurredAt: "2026-04-08T00:05:00.000Z",
            },
          },
        ],
        inboxScanCursor: {
          captureId: "capture_122",
          importedAt: "2026-04-08T00:05:00.000Z",
        },
        updatedAt: "2026-04-08T00:00:00.000Z",
        version: 1,
      })
      .mockResolvedValueOnce({
        autoReply: [
          {
            channel: "telegram",
            enabledAt: "2026-04-08T00:00:00.000Z",
            eligibleAfter: {
              captureId: "capture_123",
              occurredAt: "2026-04-08T00:10:00.000Z",
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
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      ),
    ).resolves.toEqual({
      nextWakeAt: "2026-04-08T01:15:00.000Z",
      progressed: true,
      redactedLogEntries: [
        expect.objectContaining({
          message: "Hosted assistant automation pass starting.",
        }),
        expect.objectContaining({
          message: "Hosted assistant automation event: capture.replied.",
          redacted: expect.objectContaining({
            captureIdPresent: true,
            details: "reply sent",
            type: "capture.replied",
          }),
        }),
        expect.objectContaining({
          message: "Hosted assistant automation pass finished.",
          redacted: expect.objectContaining({
            automationEventCount0: 1,
            automationEventType0: "capture.replied",
            automationEventTypeCount: 1,
            progressed: true,
            requestId: "req_123",
          }),
        }),
      ],
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          autoReplyChannels: "telegram",
          autoReplyEligibleAfterSummary: "telegram:capture_122",
          inboxScanCursor: "capture_122",
        }),
        message: "Hosted assistant automation pass starting.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          captureIdPresent: true,
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
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      ),
    ).resolves.toEqual({
      nextWakeAt: expect.any(String),
      progressed: true,
      redactedLogEntries: [
        expect.objectContaining({
          message: "Hosted assistant automation pass starting.",
        }),
        expect.objectContaining({
          message: "Hosted assistant automation could not run because the inbox runtime is not initialized yet; scheduling a retry.",
        }),
      ],
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
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      ),
    ).rejects.toThrow("automation failed");
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
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("skips device sync when the resolved registry has no providers", async () => {
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_empty_registry",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("skips device sync when the hosted runtime resolved config disables device sync", async () => {
    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_missing_env",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("logs non-fatal control-plane sync failures for non-device-sync wake events and keeps processing jobs", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 3);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
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
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
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
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
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

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
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

describe("runHostedAssistantRuntimeTimerLane", () => {
  it("runs assistant automation without sweeping parser or device-sync work", async () => {
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onTraceEvent?.({
        providerSessionId: null,
        rawEvent: {
          schema: "murph.assistant-context-diagnostics.v1",
          type: "assistant.context.diagnostics",
          stage: "assistant-session-resolved",
          source: "assistant-message",
          fingerprintReady: true,
          channel: "linq",
          actorFingerprint: "h1_111111111111111111111111",
          sessionFingerprint: "h1_222222222222222222222222",
          primaryConversationScope: "thread",
          sessionResolutionCreated: false,
          sessionTurnCount: 1,
        },
        updates: [],
      });
      return {
        nextWakeAt: "2026-04-08T01:00:00.000Z",
        progressed: false,
      };
    });

    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_assistant_lane",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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

    expect(result).toMatchObject({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      parserProcessed: 0,
      redactedLogEntries: [
        expect.objectContaining({
          message: "Hosted assistant automation pass starting.",
        }),
        expect.objectContaining({
          component: "runtime.context",
          message: "Hosted assistant context fingerprints captured.",
          redacted: expect.objectContaining({
            actorFingerprint: "h1_111111111111111111111111",
            channel: "linq",
            sessionFingerprint: "h1_222222222222222222222222",
            source: "assistant-message",
            stage: "assistant-session-resolved",
          }),
        }),
        expect.objectContaining({
          message: "Hosted assistant automation pass finished.",
        }),
      ],
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
      onTraceEvent: expect.any(Function),
      requestId: "req_123",
      vault: "/tmp/vault-root",
      vaultServices: expect.anything(),
    });
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("returns an immediate follow-up wake when assistant work is still runnable now", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runAssistantAutomationPass.mockResolvedValueOnce({
        nextWakeAt: null,
        progressed: true,
      });

      const result = await runHostedAssistantRuntimeTimerLane({
        wake: {
          eventId: "evt_assistant_progress",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
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

      expect(result).toMatchObject({
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        parserProcessed: 0,
        redactedLogEntries: [
          expect.objectContaining({
            message: "Hosted assistant automation pass starting.",
          }),
          expect.objectContaining({
            message: "Hosted assistant automation pass finished.",
          }),
        ],
      });
      expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips assistant automation without warning when the caller explicitly disables it", async () => {
    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_skip_requested",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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

    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_skip_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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

    expect(result).toMatchObject({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      redactedLogEntries: [
        expect.objectContaining({
          message:
            "Hosted assistant automation skipped because no explicit hosted assistant profile is configured.",
        }),
      ],
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

    await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_invalid_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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
      assistantProvider: "codex-cli",
    });

    await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_unready_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
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
          "Hosted assistant automation skipped because the active hosted assistant profile (codex-cli) is not ready.",
      }),
    );
  });
});

describe("runHostedDeviceSyncWakeLane", () => {
  it("runs only the hosted device-sync lane", async () => {
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
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
    });
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
  });
});

describe("runHostedNoopSystemWakeLane", () => {
  it("returns an empty follow-up result for explicit no-op system wakes", () => {
    assert.deepEqual(runHostedNoopSystemWakeLane(), {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
    });
  });
});
