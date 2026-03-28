import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createConfiguredParserRegistry: vi.fn(async () => ({
    ffmpeg: null,
    registry: {},
  })),
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
  rebuildRuntimeFromVault: vi.fn(async () => undefined),
  runAssistantAutomation: vi.fn(async () => undefined),
  saveAssistantAutomationState: vi.fn(async () => undefined),
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
  createDeviceSyncRegistry: mocks.createDeviceSyncRegistry,
  createDeviceSyncService: vi.fn(),
  createOuraDeviceSyncProvider: vi.fn(),
  createWhoopDeviceSyncProvider: vi.fn(),
}));

vi.mock("@murph/inboxd", () => ({
  openInboxRuntime: mocks.openInboxRuntime,
  rebuildRuntimeFromVault: mocks.rebuildRuntimeFromVault,
}));

vi.mock("@murph/parsers", () => ({
  createConfiguredParserRegistry: mocks.createConfiguredParserRegistry,
  createInboxParserService: mocks.createInboxParserService,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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
      runtimeEnv: {},
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
