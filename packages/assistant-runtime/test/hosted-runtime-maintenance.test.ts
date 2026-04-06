import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

import { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  createConfiguredDeviceSyncProviders: vi.fn(() => []),
  createConfiguredParserRegistry: vi.fn(async () => ({
    ffmpeg: null,
    registry: {},
  })),
  createDeviceSyncService: vi.fn(),
  createDeviceSyncRegistry: vi.fn(() => ({
    list: vi.fn(() => []),
    register: vi.fn(),
  })),
  createInboxParserService: vi.fn(() => ({
    drain: vi.fn(async () => []),
  })),
  createIntegratedInboxServices: vi.fn(() => ({
    init: vi.fn(async () => undefined),
  })),
  createIntegratedVaultServices: vi.fn(() => ({
    core: {
      init: vi.fn(async () => undefined),
    },
  })),
  ensureHostedAssistantOperatorDefaults: vi.fn(async () => ({
    configured: false,
    provider: null,
    seeded: false,
    source: "missing",
  })),
  getAssistantCronStatus: vi.fn(async () => ({
    nextRunAt: null,
  })),
  openInboxRuntime: vi.fn(async () => ({
    close: vi.fn(),
  })),
  readAssistantAutomationState: vi.fn(async () => ({
    autoReplyChannels: [],
    autoReplyBacklogChannels: [],
    updatedAt: "2026-03-28T09:00:00.000Z",
  })),
  readOperatorConfig: vi.fn(async () => null),
  reconcileHostedDeviceSyncControlPlaneState: vi.fn(async () => undefined),
  rebuildRuntimeFromVault: vi.fn(async () => undefined),
  resolveHostedAssistantConfig: vi.fn(async () => null),
  resolveHostedAssistantOperatorDefaultsState: vi.fn(() => ({
    configured: false,
    provider: null,
  })),
  runAssistantAutomation: vi.fn(async () => undefined),
  saveAssistantAutomationState: vi.fn(async () => undefined),
  syncHostedDeviceSyncControlPlaneState: vi.fn(async () => ({
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    snapshot: null,
  })),
}));

vi.mock("@murphai/assistant-core", () => ({
  createIntegratedInboxServices: mocks.createIntegratedInboxServices,
  createIntegratedVaultServices: mocks.createIntegratedVaultServices,
  ensureHostedAssistantOperatorDefaults: mocks.ensureHostedAssistantOperatorDefaults,
  getAssistantCronStatus: mocks.getAssistantCronStatus,
  readAssistantAutomationState: mocks.readAssistantAutomationState,
  readOperatorConfig: mocks.readOperatorConfig,
  resolveHostedAssistantConfig: mocks.resolveHostedAssistantConfig,
  resolveHostedAssistantOperatorDefaultsState: mocks.resolveHostedAssistantOperatorDefaultsState,
  runAssistantAutomation: mocks.runAssistantAutomation,
  saveAssistantAutomationState: mocks.saveAssistantAutomationState,
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

vi.mock("@murphai/inboxd", () => ({
  openInboxRuntime: mocks.openInboxRuntime,
  rebuildRuntimeFromVault: mocks.rebuildRuntimeFromVault,
}));

vi.mock("@murphai/parsers", () => ({
  createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
  createInboxParserService: mocks.createInboxParserService,
}));

vi.mock("../src/hosted-device-sync-runtime.ts", () => ({
  reconcileHostedDeviceSyncControlPlaneState: mocks.reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState: mocks.syncHostedDeviceSyncControlPlaneState,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOperatorConfig.mockResolvedValue(null);
  mocks.resolveHostedAssistantConfig.mockResolvedValue(null);
  mocks.resolveHostedAssistantOperatorDefaultsState.mockImplementation(() => ({
    configured: false,
    provider: null,
  }));
});

const hostedWebControlPlane = {
  deviceSyncRuntimeBaseUrl: "https://control.example.test",
  signingSecret: "dispatch-secret",
};

test("hosted maintenance loop preserves the empty-vault no-op baseline after activation bootstrap", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-maintenance-");

  try {
    const { prepareHostedDispatchContext } = await import("../src/hosted-runtime/context.ts");
    const { runHostedMaintenanceLoop } = await import("../src/hosted-runtime/maintenance.ts");

    await prepareHostedDispatchContext(
      vaultRoot,
      {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
      {},
    );

    const metrics = await runHostedMaintenanceLoop({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
      requestId: "evt_activation",
      timeoutMs: null,
      runtimeEnv: {},
      webControlPlane: hostedWebControlPlane,
      vaultRoot,
    });

    assert.deepEqual(metrics, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
    });
    assert.equal(mocks.runAssistantAutomation.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("hosted maintenance loop prefers the earliest device-sync or assistant wake", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-maintenance-");

  try {
    const deviceSyncService = {
      close: vi.fn(),
      drainWorker: vi.fn(async () => 4),
      getNextWakeAt: vi.fn(() => "2026-03-28T09:30:00.000Z"),
      runSchedulerOnce: vi.fn(async () => undefined),
      store: {
        getAccountByExternalAccount: vi.fn(() => null),
      },
    };
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: vi.fn(() => [{}]),
      register: vi.fn(),
    });
    mocks.createDeviceSyncService.mockReturnValue(deviceSyncService);
    mocks.ensureHostedAssistantOperatorDefaults.mockResolvedValue({
      configured: true,
      provider: "openai-compatible",
      seeded: false,
      source: "saved",
    });
    mocks.readOperatorConfig.mockResolvedValue({
      hostedAssistant: {
        provider: "openai-compatible",
      },
    });
    mocks.resolveHostedAssistantOperatorDefaultsState.mockImplementation(() => ({
      configured: true,
      provider: "openai-compatible",
    }));
    mocks.getAssistantCronStatus.mockResolvedValue({
      nextRunAt: "2026-03-28T10:00:00.000Z",
    });

    const { runHostedMaintenanceLoop } = await import("../src/hosted-runtime/maintenance.ts");
    const metrics = await runHostedMaintenanceLoop({
      dispatch: {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
      requestId: "evt_activation",
      timeoutMs: null,
      runtimeEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://sync.example.test",
        DEVICE_SYNC_SECRET: "secret-for-tests",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
      },
      webControlPlane: hostedWebControlPlane,
      vaultRoot,
    });

    assert.deepEqual(metrics, {
      deviceSyncProcessed: 4,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-03-28T09:30:00.000Z",
      parserProcessed: 0,
    });
    assert.equal(mocks.runAssistantAutomation.mock.calls.length, 1);
    assert.deepEqual(deviceSyncService.getNextWakeAt.mock.calls, [[]]);
  } finally {
    await cleanup();
  }
});

test("non-device-sync maintenance continues when the hosted control-plane snapshot fails", async () => {
  const originalVitest = process.env.VITEST;
  const originalStdIoLogs = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const deviceSyncService = {
    close: vi.fn(),
    drainWorker: vi.fn(async () => 2),
    getNextWakeAt: vi.fn(() => "2026-03-28T09:30:00.000Z"),
    runSchedulerOnce: vi.fn(async () => undefined),
  };

  try {
    process.env.VITEST = "true";
    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "true";
    mocks.createConfiguredDeviceSyncProviders.mockReturnValue([{} as never]);
    mocks.createDeviceSyncRegistry.mockImplementation((providers: unknown[] = []) => {
      const configured = [...providers];
      return {
        list: vi.fn(() => configured),
        register: vi.fn(),
      };
    });
    mocks.createDeviceSyncService.mockReturnValue(deviceSyncService);
    mocks.syncHostedDeviceSyncControlPlaneState.mockRejectedValueOnce(
      new Error("snapshot unavailable"),
    );

    const { runHostedDeviceSyncPass } = await import("../src/hosted-runtime/maintenance.ts");
    const result = await runHostedDeviceSyncPass(
      {
        event: {
          identityId: "assistant@mail.example.test",
          kind: "email.message.received",
          rawMessageKey: "raw_123",
          userId: "member_123",
        },
        eventId: "evt_email",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
      "/tmp/hosted-runtime-maintenance-vault",
      {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "secret",
        WHOOP_CLIENT_ID: "whoop-client",
        WHOOP_CLIENT_SECRET: "whoop-secret",
      },
      hostedWebControlPlane,
      9_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-03-28T09:30:00.000Z",
      processedJobs: 2,
      skipped: false,
    });
    assert.equal(mocks.syncHostedDeviceSyncControlPlaneState.mock.calls.length, 1);
    assert.equal(mocks.reconcileHostedDeviceSyncControlPlaneState.mock.calls.length, 0);
    assert.equal(deviceSyncService.runSchedulerOnce.mock.calls.length, 1);
    assert.equal(deviceSyncService.drainWorker.mock.calls.length, 1);
    assert.equal(warnSpy.mock.calls.length, 1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0])) as {
      component: string;
      errorCode: string;
      errorMessage: string;
      eventId: string;
      level: string;
      message: string;
      userId: string | null;
    };
    assert.equal(payload.component, "runtime");
    assert.equal(payload.errorCode, "runtime_error");
    assert.equal(payload.errorMessage, "Hosted execution runtime failed.");
    assert.equal(payload.eventId, "evt_email");
    assert.equal(payload.level, "warn");
    assert.equal(payload.message, "Hosted device-sync control-plane sync failed; continuing hosted job.");
    assert.equal(payload.userId, null);
  } finally {
    if (originalVitest === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitest;
    }

    if (originalStdIoLogs === undefined) {
      delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    } else {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = originalStdIoLogs;
    }
    warnSpy.mockRestore();
  }
});

test("non-device-sync maintenance continues when the hosted control-plane apply fails", async () => {
  const originalVitest = process.env.VITEST;
  const originalStdIoLogs = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const deviceSyncService = {
    close: vi.fn(),
    drainWorker: vi.fn(async () => 1),
    getNextWakeAt: vi.fn(() => null),
    runSchedulerOnce: vi.fn(async () => undefined),
  };

  try {
    process.env.VITEST = "true";
    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "true";
    mocks.createConfiguredDeviceSyncProviders.mockReturnValue([{} as never]);
    mocks.createDeviceSyncRegistry.mockImplementation((initialProviders: unknown[] = []) => {
      const providers = [...initialProviders];
      return {
        list: vi.fn(() => providers),
        register: vi.fn((provider: unknown) => {
          providers.push(provider);
        }),
      };
    });
    mocks.createDeviceSyncService.mockReturnValue(deviceSyncService);
    mocks.reconcileHostedDeviceSyncControlPlaneState.mockRejectedValueOnce(
      new Error("apply unavailable"),
    );

    const { runHostedDeviceSyncPass } = await import("../src/hosted-runtime/maintenance.ts");
    const result = await runHostedDeviceSyncPass(
      {
        event: {
          kind: "assistant.cron.tick",
          userId: "member_123",
        },
        eventId: "evt_cron",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
      "/tmp/hosted-runtime-maintenance-vault",
      {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "secret",
        WHOOP_CLIENT_ID: "whoop-client",
        WHOOP_CLIENT_SECRET: "whoop-secret",
      },
      hostedWebControlPlane,
      12_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      processedJobs: 1,
      skipped: false,
    });
    assert.equal(mocks.syncHostedDeviceSyncControlPlaneState.mock.calls.length, 1);
    assert.equal(mocks.reconcileHostedDeviceSyncControlPlaneState.mock.calls.length, 1);
    assert.equal(warnSpy.mock.calls.length, 1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0])) as {
      component: string;
      errorCode: string;
      errorMessage: string;
      eventId: string;
      level: string;
      message: string;
      userId: string | null;
    };
    assert.equal(payload.component, "runtime");
    assert.equal(payload.errorCode, "runtime_error");
    assert.equal(payload.errorMessage, "Hosted execution runtime failed.");
    assert.equal(payload.eventId, "evt_cron");
    assert.equal(payload.level, "warn");
    assert.equal(payload.message, "Hosted device-sync control-plane reconcile failed; continuing hosted job.");
    assert.equal(payload.userId, null);
  } finally {
    if (originalVitest === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitest;
    }

    if (originalStdIoLogs === undefined) {
      delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    } else {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = originalStdIoLogs;
    }
    warnSpy.mockRestore();
  }
});

test("device-sync wake maintenance still fails hard on hosted control-plane errors", async () => {
  const deviceSyncService = {
    close: vi.fn(),
    drainWorker: vi.fn(async () => 0),
    getNextWakeAt: vi.fn(() => null),
    runSchedulerOnce: vi.fn(async () => undefined),
  };

  mocks.createConfiguredDeviceSyncProviders.mockReturnValue([{} as never]);
  mocks.createDeviceSyncRegistry.mockImplementation((initialProviders: unknown[] = []) => {
    const providers = [...initialProviders];
    return {
      list: vi.fn(() => providers),
      register: vi.fn((provider: unknown) => {
        providers.push(provider);
      }),
    };
  });
  mocks.createDeviceSyncService.mockReturnValue(deviceSyncService);
  mocks.syncHostedDeviceSyncControlPlaneState.mockRejectedValueOnce(
    new Error("snapshot unavailable"),
  );

  const { runHostedDeviceSyncPass } = await import("../src/hosted-runtime/maintenance.ts");

  await assert.rejects(
    () =>
      runHostedDeviceSyncPass(
        {
          event: {
            kind: "device-sync.wake",
            provider: "whoop",
            reason: "connected",
            userId: "member_123",
          },
          eventId: "evt_device_sync",
          occurredAt: "2026-03-28T09:00:00.000Z",
        },
        "/tmp/hosted-runtime-maintenance-vault",
        {
          DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
          DEVICE_SYNC_SECRET: "secret",
          WHOOP_CLIENT_ID: "whoop-client",
          WHOOP_CLIENT_SECRET: "whoop-secret",
        },
        hostedWebControlPlane,
        15_000,
      ),
    /snapshot unavailable/,
  );
});
