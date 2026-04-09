import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAssistantFoodAutoLogHooks: vi.fn(),
  createConfiguredDeviceSyncProviders: vi.fn(),
  createConfiguredParserRegistry: vi.fn(),
  createDeviceSyncRegistry: vi.fn(),
  createDeviceSyncService: vi.fn(),
  createInboxParserService: vi.fn(),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  getAssistantCronStatus: vi.fn(),
  openInboxRuntime: vi.fn(),
  readHostedAssistantRuntimeState: vi.fn(),
  rebuildRuntimeFromVault: vi.fn(),
  reconcileHostedDeviceSyncControlPlaneState: vi.fn(),
  runAssistantAutomation: vi.fn(),
  syncHostedDeviceSyncControlPlaneState: vi.fn(),
}));

vi.mock("@murphai/device-syncd/config", () => ({
  createConfiguredDeviceSyncProviders: mocks.createConfiguredDeviceSyncProviders,
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
  getAssistantCronStatus: mocks.getAssistantCronStatus,
  runAssistantAutomation: mocks.runAssistantAutomation,
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
  runHostedAssistantAutomation,
  runHostedDeviceSyncPass,
  runHostedMaintenanceLoop,
} from "../src/hosted-runtime/maintenance.ts";

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
    assistantConfigStatus: "saved",
    assistantConfigured: true,
    assistantProvider: "openai-compatible",
  });
  mocks.getAssistantCronStatus.mockResolvedValue({
    nextRunAt: "2026-04-08T01:00:00.000Z",
  });
  mocks.createConfiguredDeviceSyncProviders.mockReturnValue(["oura"]);
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

    assert.deepEqual(result, {
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

describe("runHostedAssistantAutomation", () => {
  it("treats missing inbox runtime state as a non-fatal bootstrap gap", async () => {
    mocks.runAssistantAutomation.mockRejectedValueOnce({
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
      ),
    ).resolves.toBeUndefined();
  });

  it("rethrows unexpected automation failures", async () => {
    mocks.runAssistantAutomation.mockRejectedValueOnce(new Error("automation failed"));

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
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_skip",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      "/tmp/vault-root",
      {},
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

  it("skips device sync when the hosted runtime is missing required env even if providers exist", async () => {
    const result = await runHostedDeviceSyncPass(
      {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_missing_env",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      "/tmp/vault-root",
      {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      },
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
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_continue",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      "/tmp/vault-root",
      {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "secret_123",
      },
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
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_reconcile_continue",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      "/tmp/vault-root",
      {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "secret_123",
      },
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
          event: {
            hint: null,
            kind: "device-sync.wake",
            reason: "webhook_hint",
            runtimeSnapshot: null,
            userId: "member_123",
          },
          eventId: "evt_wake",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        "/tmp/vault-root",
        {
          DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
          DEVICE_SYNC_SECRET: "secret_123",
        },
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
          event: {
            hint: null,
            kind: "device-sync.wake",
            reason: "webhook_hint",
            runtimeSnapshot: null,
            userId: "member_123",
          },
          eventId: "evt_wake_reconcile",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        "/tmp/vault-root",
        {
          DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
          DEVICE_SYNC_SECRET: "secret_123",
        },
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

describe("runHostedMaintenanceLoop", () => {
  it("runs assistant automation when the hosted assistant is ready and picks the earliest wake time", async () => {
    const close = vi.fn();

    mocks.openInboxRuntime.mockResolvedValue({
      close,
      getCapture: () => null,
      listAttachmentParseJobs: () => [],
    });
    mocks.createInboxParserService.mockReturnValue({
      drain: vi.fn(async () => []),
    });
    mocks.createDeviceSyncService.mockReturnValue({
      close: vi.fn(),
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => "2026-04-08T00:30:00.000Z",
      runSchedulerOnce: vi.fn(async () => undefined),
    });

    const result = await runHostedMaintenanceLoop({
      deviceSyncPort: {
        applyUpdates: vi.fn(),
        createConnectLink: vi.fn(),
        fetchSnapshot: vi.fn(),
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_maintenance",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtimeEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "secret_123",
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
    expect(mocks.runAssistantAutomation).toHaveBeenCalledWith({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      executionContext: {
        hosted: {
          issueDeviceConnectLink: expect.any(Function),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      inboxServices: expect.any(Symbol),
      once: true,
      requestId: "req_123",
      startDaemon: false,
      vault: "/tmp/vault-root",
      vaultServices: expect.any(Symbol),
    });
    expect(mocks.getAssistantCronStatus).toHaveBeenCalledWith("/tmp/vault-root");
  });

  it("skips assistant automation without warning when the caller explicitly disables it", async () => {
    const close = vi.fn();

    mocks.openInboxRuntime.mockResolvedValue({
      close,
      getCapture: () => null,
      listAttachmentParseJobs: () => [],
    });
    mocks.createInboxParserService.mockReturnValue({
      drain: vi.fn(async () => []),
    });
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedMaintenanceLoop({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_skip_requested",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtimeEnv: {},
      skipAssistantAutomation: true,
      timeoutMs: 45_000,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(mocks.runAssistantAutomation).not.toHaveBeenCalled();
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("logs skipped automation when the hosted assistant is not configured", async () => {
    const close = vi.fn();

    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
    });
    mocks.openInboxRuntime.mockResolvedValue({
      close,
      getCapture: () => null,
      listAttachmentParseJobs: () => [],
    });
    mocks.createInboxParserService.mockReturnValue({
      drain: vi.fn(async () => []),
    });
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedMaintenanceLoop({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_skip_automation",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtimeEnv: {},
      timeoutMs: 45_000,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
    });
    expect(mocks.runAssistantAutomation).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because no explicit hosted assistant profile is configured.",
      }),
    );
  });

  it("reports invalid hosted assistant configs when automation is skipped", async () => {
    const close = vi.fn();

    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantConfigStatus: "invalid",
      assistantConfigured: false,
      assistantProvider: null,
    });
    mocks.openInboxRuntime.mockResolvedValue({
      close,
      getCapture: () => null,
      listAttachmentParseJobs: () => [],
    });
    mocks.createInboxParserService.mockReturnValue({
      drain: vi.fn(async () => []),
    });
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    await runHostedMaintenanceLoop({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_invalid_automation",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtimeEnv: {},
      timeoutMs: 45_000,
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
});
