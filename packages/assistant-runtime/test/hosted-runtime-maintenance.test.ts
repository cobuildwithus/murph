import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, test, vi } from "vitest";

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
  createIntegratedInboxCliServices: vi.fn(() => ({
    init: vi.fn(async () => undefined),
  })),
  createIntegratedVaultCliServices: vi.fn(() => ({
    core: {
      init: vi.fn(async () => undefined),
    },
  })),
  getAssistantCronStatus: vi.fn(async () => ({
    nextRunAt: null,
  })),
  openInboxRuntime: vi.fn(async () => ({
    close: vi.fn(),
  })),
  readAssistantAutomationState: vi.fn(async () => ({
    autoReplyChannels: [],
    updatedAt: "2026-03-28T09:00:00.000Z",
  })),
  reconcileHostedDeviceSyncControlPlaneState: vi.fn(async () => undefined),
  rebuildRuntimeFromVault: vi.fn(async () => undefined),
  runAssistantAutomation: vi.fn(async () => undefined),
  saveAssistantAutomationState: vi.fn(async () => undefined),
  syncHostedDeviceSyncControlPlaneState: vi.fn(async () => ({
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    snapshot: null,
  })),
}));

vi.mock("@murph/assistant-services/automation", () => ({
  runAssistantAutomation: mocks.runAssistantAutomation,
}));

vi.mock("@murph/assistant-services/cron", () => ({
  getAssistantCronStatus: mocks.getAssistantCronStatus,
}));

vi.mock("@murph/assistant-services/inbox-services", () => ({
  createIntegratedInboxCliServices: mocks.createIntegratedInboxCliServices,
}));

vi.mock("@murph/assistant-services/store", () => ({
  readAssistantAutomationState: mocks.readAssistantAutomationState,
  saveAssistantAutomationState: mocks.saveAssistantAutomationState,
}));

vi.mock("@murph/assistant-services/vault-services", () => ({
  createIntegratedVaultCliServices: mocks.createIntegratedVaultCliServices,
}));

vi.mock("@murph/device-syncd", () => ({
  createConfiguredDeviceSyncProviders: mocks.createConfiguredDeviceSyncProviders,
  createDeviceSyncRegistry: mocks.createDeviceSyncRegistry,
  createDeviceSyncService: mocks.createDeviceSyncService,
}));

vi.mock("@murph/inboxd", () => ({
  openInboxRuntime: mocks.openInboxRuntime,
  rebuildRuntimeFromVault: mocks.rebuildRuntimeFromVault,
}));

vi.mock("@murph/parsers", () => ({
  createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
  createInboxParserService: mocks.createInboxParserService,
}));

vi.mock("../src/hosted-device-sync-runtime.ts", () => ({
  reconcileHostedDeviceSyncControlPlaneState: mocks.reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState: mocks.syncHostedDeviceSyncControlPlaneState,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const hostedWebControlPlane = {
  deviceSyncRuntimeBaseUrl: "https://control.example.test",
  internalToken: "internal-token",
};

test("hosted maintenance loop preserves the empty-vault no-op baseline after activation bootstrap", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runtime-maintenance-"));
  const vaultRoot = path.join(workspaceRoot, "vault");

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
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted maintenance loop prefers the earliest device-sync or assistant wake", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runtime-maintenance-"));
  const vaultRoot = path.join(workspaceRoot, "vault");

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
    assert.deepEqual(deviceSyncService.getNextWakeAt.mock.calls, [[]]);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("non-device-sync maintenance continues when the hosted control-plane snapshot fails", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const deviceSyncService = {
    close: vi.fn(),
    drainWorker: vi.fn(async () => 2),
    getNextWakeAt: vi.fn(() => "2026-03-28T09:30:00.000Z"),
    runSchedulerOnce: vi.fn(async () => undefined),
  };

  try {
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
          envelopeTo: "assistant@mail.example.test",
          identityId: "assistant@mail.example.test",
          kind: "email.message.received",
          rawMessageKey: "raw_123",
          threadTarget: null,
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
  } finally {
    warnSpy.mockRestore();
  }
});

test("non-device-sync maintenance continues when the hosted control-plane apply fails", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const deviceSyncService = {
    close: vi.fn(),
    drainWorker: vi.fn(async () => 1),
    getNextWakeAt: vi.fn(() => null),
    runSchedulerOnce: vi.fn(async () => undefined),
  };

  try {
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
  } finally {
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
