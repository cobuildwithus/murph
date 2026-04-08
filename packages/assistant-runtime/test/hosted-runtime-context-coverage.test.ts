import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAssistantFoodAutoLogHooks: vi.fn(() => ({ kind: "food-hooks" })),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  ensureHostedAssistantOperatorDefaults: vi.fn(),
  inboxInit: vi.fn(),
  normalizeNullableString: vi.fn((value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : null
  ),
  readAssistantAutomationState: vi.fn(),
  readHostedEmailCapabilities: vi.fn(),
  readOperatorConfig: vi.fn(),
  resolveHostedAssistantConfig: vi.fn(),
  resolveHostedAssistantOperatorDefaultsState: vi.fn(),
  saveAssistantAutomationState: vi.fn(),
  vaultInit: vi.fn(),
}));

vi.mock("@murphai/contracts", () => ({
  VAULT_LAYOUT: {
    metadata: "vault.json",
  },
}));

vi.mock("@murphai/hosted-execution", () => ({
  readHostedEmailCapabilities: mocks.readHostedEmailCapabilities,
}));

vi.mock("@murphai/assistant-engine", () => ({
  createAssistantFoodAutoLogHooks: mocks.createAssistantFoodAutoLogHooks,
  readAssistantAutomationState: mocks.readAssistantAutomationState,
  saveAssistantAutomationState: mocks.saveAssistantAutomationState,
}));

vi.mock("@murphai/inbox-services", () => ({
  createIntegratedInboxServices: mocks.createIntegratedInboxServices,
}));

vi.mock("@murphai/vault-usecases/vault-services", () => ({
  createIntegratedVaultServices: mocks.createIntegratedVaultServices,
}));

vi.mock("@murphai/operator-config/hosted-assistant-config", () => ({
  ensureHostedAssistantOperatorDefaults: mocks.ensureHostedAssistantOperatorDefaults,
  resolveHostedAssistantOperatorDefaultsState: mocks.resolveHostedAssistantOperatorDefaultsState,
}));

vi.mock("@murphai/operator-config/operator-config", () => ({
  readOperatorConfig: mocks.readOperatorConfig,
  resolveHostedAssistantConfig: mocks.resolveHostedAssistantConfig,
}));

vi.mock("@murphai/operator-config/text/shared", () => ({
  normalizeNullableString: mocks.normalizeNullableString,
}));

import {
  prepareHostedDispatchContext,
  readHostedAssistantRuntimeState,
  reconcileHostedAssistantChannelCapabilities,
  requireHostedBootstrapForDispatch,
} from "../src/hosted-runtime/context.ts";

async function createWorkspace(): Promise<{ cleanup: () => Promise<void>; vaultRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "hosted-runtime-context-coverage-"));
  const vaultRoot = path.join(root, "vault");
  await mkdir(vaultRoot, { recursive: true });

  return {
    cleanup: () => rm(root, { force: true, recursive: true }),
    vaultRoot,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createIntegratedInboxServices.mockReturnValue({
    init: mocks.inboxInit,
  });
  mocks.createIntegratedVaultServices.mockReturnValue({
    core: {
      init: mocks.vaultInit,
    },
  });
  mocks.ensureHostedAssistantOperatorDefaults.mockResolvedValue({
    configured: false,
    provider: null,
    seeded: false,
    source: "missing",
  });
  mocks.readAssistantAutomationState.mockResolvedValue({
    autoReplyBacklogChannels: [],
    autoReplyChannels: [],
    autoReplyPrimed: false,
    autoReplyScanCursor: null,
    updatedAt: "2026-04-08T00:00:00.000Z",
  });
  mocks.readHostedEmailCapabilities.mockReturnValue({
    sendReady: false,
  });
  mocks.readOperatorConfig.mockResolvedValue(null);
  mocks.resolveHostedAssistantConfig.mockResolvedValue(null);
  mocks.resolveHostedAssistantOperatorDefaultsState.mockReturnValue({
    configured: false,
    provider: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("hosted runtime context coverage", () => {
  it("returns null for non-activation dispatches after bootstrap and skips channel reconciliation", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await writeFile(path.join(vaultRoot, "vault.json"), "{}", "utf8");
      mocks.ensureHostedAssistantOperatorDefaults.mockResolvedValue({
        configured: true,
        provider: "openai-compatible",
        seeded: false,
        source: "saved",
      });

      const result = await prepareHostedDispatchContext(
        vaultRoot,
        {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_123",
          },
          eventId: "evt_tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        {
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
      );

      assert.equal(result, null);
      expect(mocks.readAssistantAutomationState).not.toHaveBeenCalled();
      expect(mocks.vaultInit).not.toHaveBeenCalled();
      expect(mocks.inboxInit).toHaveBeenCalledWith({
        rebuild: false,
        requestId: "evt_tick",
        vault: vaultRoot,
      });
    } finally {
      await cleanup();
    }
  });

  it("normalizes activation bootstrap to unready when defaults are present but not configured", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      mocks.ensureHostedAssistantOperatorDefaults.mockResolvedValue({
        configured: false,
        provider: null,
        seeded: false,
        source: "saved",
      });

      const result = await prepareHostedDispatchContext(
        vaultRoot,
        {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_activation",
          occurredAt: "2026-04-08T00:05:00.000Z",
        },
        {
          HOSTED_EMAIL_DOMAIN: "mail.example.test",
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
      );

      assert.deepEqual(result, {
        assistantConfigStatus: "unready",
        assistantConfigured: false,
        assistantProvider: null,
        assistantSeeded: false,
        emailAutoReplyEnabled: false,
        telegramAutoReplyEnabled: false,
        vaultCreated: true,
      });
      expect(mocks.vaultInit).toHaveBeenCalledWith({
        requestId: "evt_activation",
        vault: vaultRoot,
      });
      expect(mocks.saveAssistantAutomationState).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("reads invalid, missing, unready, and saved runtime states from operator config", async () => {
    mocks.readOperatorConfig.mockResolvedValueOnce({
      hostedAssistant: {
        profiles: [],
      },
      hostedAssistantInvalid: true,
    });
    mocks.resolveHostedAssistantOperatorDefaultsState.mockReturnValueOnce({
      configured: false,
      provider: null,
    });
    await expect(readHostedAssistantRuntimeState()).resolves.toEqual({
      assistantConfigStatus: "invalid",
      assistantConfigured: false,
      assistantProvider: null,
    });

    mocks.readOperatorConfig.mockResolvedValueOnce(null);
    mocks.resolveHostedAssistantConfig.mockResolvedValueOnce(null);
    mocks.resolveHostedAssistantOperatorDefaultsState.mockReturnValueOnce({
      configured: false,
      provider: null,
    });
    await expect(readHostedAssistantRuntimeState()).resolves.toEqual({
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
    });

    mocks.readOperatorConfig.mockResolvedValueOnce({
      hostedAssistant: {
        profiles: [],
      },
    });
    mocks.resolveHostedAssistantOperatorDefaultsState.mockReturnValueOnce({
      configured: false,
      provider: "openai-compatible",
    });
    await expect(readHostedAssistantRuntimeState()).resolves.toEqual({
      assistantConfigStatus: "unready",
      assistantConfigured: false,
      assistantProvider: "openai-compatible",
    });

    mocks.readOperatorConfig.mockResolvedValueOnce({
      hostedAssistant: {
        profiles: [],
      },
    });
    mocks.resolveHostedAssistantOperatorDefaultsState.mockReturnValueOnce({
      configured: true,
      provider: "openai-compatible",
    });
    await expect(readHostedAssistantRuntimeState()).resolves.toEqual({
      assistantConfigStatus: "saved",
      assistantConfigured: true,
      assistantProvider: "openai-compatible",
    });
  });

  it("leaves automation state untouched when reconciled channels already match capabilities", async () => {
    mocks.readHostedEmailCapabilities.mockReturnValue({
      sendReady: true,
    });
    mocks.readAssistantAutomationState.mockResolvedValue({
      autoReplyBacklogChannels: ["linq", "email"],
      autoReplyChannels: ["linq", "email", "telegram"],
      autoReplyPrimed: true,
      autoReplyScanCursor: "cursor_123",
      updatedAt: "2026-04-08T00:00:00.000Z",
    });

    await expect(
      reconcileHostedAssistantChannelCapabilities(
        "/tmp/assistant-runtime-context-coverage",
        {
          TELEGRAM_BOT_TOKEN: "telegram-token",
        },
        true,
      ),
    ).resolves.toEqual({
      emailAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
    expect(mocks.saveAssistantAutomationState).not.toHaveBeenCalled();
  });

  it("allows both existing and activation bootstrap paths", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await writeFile(path.join(vaultRoot, "vault.json"), "{}", "utf8");
      await expect(
        requireHostedBootstrapForDispatch(vaultRoot, {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_123",
          },
          eventId: "evt_tick",
          occurredAt: "2026-04-08T00:10:00.000Z",
        }),
      ).resolves.toBeUndefined();

      await rm(path.join(vaultRoot, "vault.json"), { force: true });

      await expect(
        requireHostedBootstrapForDispatch(vaultRoot, {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_activation",
          occurredAt: "2026-04-08T00:15:00.000Z",
        }),
      ).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
