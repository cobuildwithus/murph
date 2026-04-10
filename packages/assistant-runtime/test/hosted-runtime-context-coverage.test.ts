import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

const mocks = vi.hoisted(() => ({
  createAssistantFoodAutoLogHooks: vi.fn(() => ({ kind: "food-hooks" })),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  ensureHostedAssistantOperatorDefaults: vi.fn(),
  inboxInit: vi.fn(),
  inboxList: vi.fn(),
  readOperatorConfig: vi.fn(),
  resolveHostedAssistantConfig: vi.fn(),
  resolveHostedAssistantOperatorDefaultsState: vi.fn(),
  vaultInit: vi.fn(),
}));

vi.mock("@murphai/contracts", async () => {
  const actual = await vi.importActual<typeof import("@murphai/contracts")>(
    "@murphai/contracts",
  );

  return {
    ...actual,
    VAULT_LAYOUT: {
      ...actual.VAULT_LAYOUT,
      metadata: "vault.json",
    },
  };
});

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );

  return {
    ...actual,
    createAssistantFoodAutoLogHooks: mocks.createAssistantFoodAutoLogHooks,
  };
});

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

vi.mock("@murphai/operator-config/operator-config", async () => {
  const actual = await vi.importActual<
    typeof import("@murphai/operator-config/operator-config")
  >("@murphai/operator-config/operator-config");

  return {
    ...actual,
    readOperatorConfig: mocks.readOperatorConfig,
    resolveHostedAssistantConfig: mocks.resolveHostedAssistantConfig,
  };
});

import {
  prepareHostedDispatchContext,
  readHostedAssistantRuntimeState,
  reconcileHostedAssistantChannelCapabilities,
  requireHostedBootstrapForDispatch,
} from "../src/hosted-runtime/context.ts";
import { createHostedRuntimeResolvedConfig } from "./hosted-runtime-test-helpers.ts";

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
    list: mocks.inboxList,
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
  mocks.inboxList.mockResolvedValue({
    items: [],
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

async function readAutomationState(vaultRoot: string) {
  return JSON.parse(
    await readFile(resolveAssistantStatePaths(vaultRoot).automationStatePath, "utf8"),
  ) as {
    autoReply: Array<{
      channel: string;
      cursor: { captureId: string; occurredAt: string } | null;
    }>;
    inboxScanCursor: { captureId: string; occurredAt: string } | null;
    updatedAt: string;
    version: number;
  };
}

async function writeAutomationState(
  vaultRoot: string,
  state: {
    autoReply: Array<{
      channel: string;
      cursor: { captureId: string; occurredAt: string } | null;
    }>;
    inboxScanCursor: { captureId: string; occurredAt: string } | null;
    updatedAt: string;
    version: number;
  },
): Promise<void> {
  const automationStatePath = resolveAssistantStatePaths(vaultRoot).automationStatePath;
  await mkdir(path.dirname(automationStatePath), {
    recursive: true,
  });
  await writeFile(automationStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

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
        createHostedRuntimeResolvedConfig({
          channelCapabilities: {
            emailSendReady: false,
            telegramBotConfigured: true,
          },
        }),
      );

      assert.equal(result, null);
      expect(mocks.inboxList).not.toHaveBeenCalled();
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
        createHostedRuntimeResolvedConfig({
          channelCapabilities: {
            emailSendReady: true,
            telegramBotConfigured: true,
          },
        }),
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
      await expect(readAutomationState(vaultRoot)).resolves.toMatchObject({
        autoReply: [],
        inboxScanCursor: null,
        version: 1,
      });
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

  it("leaves automation state untouched when hosted auto-reply entries already match capabilities", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await writeAutomationState(vaultRoot, {
        version: 1,
        inboxScanCursor: null,
        autoReply: [
          {
            channel: "email",
            cursor: {
              captureId: "cap_email",
              occurredAt: "2026-04-08T00:00:00.000Z",
            },
          },
          {
            channel: "linq",
            cursor: null,
          },
          {
            channel: "telegram",
            cursor: {
              captureId: "cap_telegram",
              occurredAt: "2026-04-08T00:01:00.000Z",
            },
          },
        ],
        updatedAt: "2026-04-08T00:05:00.000Z",
      });

      await expect(
        reconcileHostedAssistantChannelCapabilities(
          vaultRoot,
          {
            emailSendReady: true,
            telegramBotConfigured: true,
          },
          true,
        ),
      ).resolves.toEqual({
        emailAutoReplyEnabled: true,
        telegramAutoReplyEnabled: true,
      });

      await expect(readAutomationState(vaultRoot)).resolves.toEqual({
        version: 1,
        inboxScanCursor: null,
        autoReply: [
          {
            channel: "email",
            cursor: {
              captureId: "cap_email",
              occurredAt: "2026-04-08T00:00:00.000Z",
            },
          },
          {
            channel: "linq",
            cursor: null,
          },
          {
            channel: "telegram",
            cursor: {
              captureId: "cap_telegram",
              occurredAt: "2026-04-08T00:01:00.000Z",
            },
          },
        ],
        updatedAt: "2026-04-08T00:05:00.000Z",
      });
      expect(mocks.inboxList).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("seeds the latest persisted inbox capture when re-enabling a hosted channel", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await writeAutomationState(vaultRoot, {
        version: 1,
        inboxScanCursor: {
          captureId: "cap_route",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        autoReply: [
          {
            channel: "linq",
            cursor: {
              captureId: "cap_linq",
              occurredAt: "2026-04-08T00:00:00.000Z",
            },
          },
        ],
        updatedAt: "2026-04-08T00:05:00.000Z",
      });
      mocks.inboxList.mockResolvedValue({
        items: [
          {
            captureId: "cap_latest",
            occurredAt: "2026-04-08T00:09:00.000Z",
          },
        ],
      });

      await expect(
        reconcileHostedAssistantChannelCapabilities(
          vaultRoot,
          {
            emailSendReady: true,
            telegramBotConfigured: false,
          },
          true,
        ),
      ).resolves.toEqual({
        emailAutoReplyEnabled: true,
        telegramAutoReplyEnabled: false,
      });

      await expect(readAutomationState(vaultRoot)).resolves.toMatchObject({
        inboxScanCursor: {
          captureId: "cap_route",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        autoReply: [
          {
            channel: "email",
            cursor: {
              captureId: "cap_latest",
              occurredAt: "2026-04-08T00:09:00.000Z",
            },
          },
          {
            channel: "linq",
            cursor: {
              captureId: "cap_linq",
              occurredAt: "2026-04-08T00:00:00.000Z",
            },
          },
        ],
        version: 1,
      });
      expect(mocks.inboxList).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
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
