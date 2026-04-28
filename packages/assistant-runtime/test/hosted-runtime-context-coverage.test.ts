import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

const mocks = vi.hoisted(() => ({
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

vi.mock("@murphai/inbox-services", () => ({
  createIntegratedInboxServices: mocks.createIntegratedInboxServices,
}));

vi.mock("@murphai/vault-usecases/vault-services", () => ({
  createIntegratedVaultServices: mocks.createIntegratedVaultServices,
}));

vi.mock("@murphai/operator-config/hosted-assistant-config", async () => {
  const actual = await vi.importActual<
    typeof import("@murphai/operator-config/hosted-assistant-config")
  >("@murphai/operator-config/hosted-assistant-config");

  return {
    ...actual,
    ensureHostedAssistantOperatorDefaults: mocks.ensureHostedAssistantOperatorDefaults,
    resolveHostedAssistantOperatorDefaultsState: mocks.resolveHostedAssistantOperatorDefaultsState,
  };
});

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
  prepareHostedWakeContext,
  readHostedAssistantRuntimeState,
  reconcileHostedAssistantChannelState,
  requireHostedBootstrapForWake,
} from "../src/hosted-runtime/context.ts";
import { createHostedRuntimeResolvedConfig } from "./hosted-runtime-test-helpers.ts";

const DEFAULT_MEMBER_CHANNELS = {
  email: true,
  linq: true,
  telegram: true,
} as const;

function buildLegacyWake(input: {
  event: Record<string, unknown> & { kind: string; userId?: string };
  eventId: string;
  occurredAt: string;
}) {
  switch (input.event.kind) {
    case "device-sync.wake":
      return buildHostedExecutionDeviceSyncWake({
        eventId: input.eventId,
        occurredAt: input.occurredAt,
        reason: input.event.reason as "connected" | "disconnected" | "reauthorization_required" | "reconcile_due" | "webhook_hint",
        userId: input.event.userId ?? "member_123",
      });
    case "member.activated":
      return buildHostedExecutionMemberActivatedWake({
        eventId: input.eventId,
        memberChannels: input.event.memberChannels as typeof DEFAULT_MEMBER_CHANNELS,
        memberId: input.event.userId ?? "member_123",
        occurredAt: input.occurredAt,
      });
    default:
      throw new Error(`Unsupported legacy wake kind: ${input.event.kind}`);
  }
}

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
  it("returns null for non-activation wakes after bootstrap and skips channel reconciliation", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await writeFile(path.join(vaultRoot, "vault.json"), "{}", "utf8");
      mocks.ensureHostedAssistantOperatorDefaults.mockResolvedValue({
        configured: true,
        provider: "codex-cli",
        seeded: false,
        source: "saved",
      });

      const result = await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "device-sync.wake",
            reason: "connected",
            userId: "member_123",
          },
          eventId: "evt_tick",
          occurredAt: "2026-04-08T00:00:00.000Z",
        }),
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
        rebuild: true,
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

      const result = await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            memberChannels: {
              email: false,
              linq: false,
              telegram: false,
            },
            userId: "member_123",
          },
          eventId: "evt_activation",
          occurredAt: "2026-04-08T00:05:00.000Z",
        }),
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
        assistantActiveProfileId: null,
        assistantActiveProfileManagedBy: null,
        assistantActiveProfileReady: false,
        assistantConfigInvalid: false,
        assistantConfigPresent: true,
        assistantConfigStatus: "unready",
        assistantConfigured: false,
        assistantProvider: null,
        assistantSeeded: false,
        emailAutoReplyEnabled: false,
        linqAutoReplyEnabled: false,
        telegramAutoReplyEnabled: false,
        vaultCreated: true,
      });
      expect(mocks.vaultInit).toHaveBeenCalledWith({
        requestId: "evt_activation",
        timezone: "America/New_York",
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
      assistantActiveProfileId: null,
      assistantActiveProfileManagedBy: null,
      assistantActiveProfileReady: false,
      assistantConfigInvalid: true,
      assistantConfigPresent: true,
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
      assistantActiveProfileId: null,
      assistantActiveProfileManagedBy: null,
      assistantActiveProfileReady: false,
      assistantConfigInvalid: false,
      assistantConfigPresent: false,
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
      provider: "codex-cli",
    });
    await expect(readHostedAssistantRuntimeState()).resolves.toEqual({
      assistantActiveProfileId: null,
      assistantActiveProfileManagedBy: null,
      assistantActiveProfileReady: false,
      assistantConfigInvalid: false,
      assistantConfigPresent: true,
      assistantConfigStatus: "unready",
      assistantConfigured: false,
      assistantProvider: "codex-cli",
    });

    mocks.readOperatorConfig.mockResolvedValueOnce({
      hostedAssistant: {
        profiles: [],
      },
    });
    mocks.resolveHostedAssistantOperatorDefaultsState.mockReturnValueOnce({
      configured: true,
      provider: "codex-cli",
    });
    await expect(readHostedAssistantRuntimeState()).resolves.toEqual({
      assistantActiveProfileId: null,
      assistantActiveProfileManagedBy: null,
      assistantActiveProfileReady: false,
      assistantConfigInvalid: false,
      assistantConfigPresent: true,
      assistantConfigStatus: "saved",
      assistantConfigured: true,
      assistantProvider: "codex-cli",
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
        reconcileHostedAssistantChannelState(
          vaultRoot,
          DEFAULT_MEMBER_CHANNELS,
          {
            emailSendReady: true,
            telegramBotConfigured: true,
          },
          true,
        ),
      ).resolves.toEqual({
        emailAutoReplyEnabled: true,
        linqAutoReplyEnabled: true,
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
        reconcileHostedAssistantChannelState(
          vaultRoot,
          {
            email: true,
            linq: true,
            telegram: false,
          },
          {
            emailSendReady: true,
            telegramBotConfigured: false,
          },
          true,
        ),
      ).resolves.toEqual({
        emailAutoReplyEnabled: true,
        linqAutoReplyEnabled: true,
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
        requireHostedBootstrapForWake(
          vaultRoot,
          buildLegacyWake({
            event: {
              kind: "device-sync.wake",
              reason: "connected",
              userId: "member_123",
            },
            eventId: "evt_tick",
            occurredAt: "2026-04-08T00:10:00.000Z",
          }),
        ),
      ).resolves.toBeUndefined();

      await rm(path.join(vaultRoot, "vault.json"), { force: true });

      await expect(
        requireHostedBootstrapForWake(
          vaultRoot,
          buildLegacyWake({
            event: {
              kind: "member.activated",
              memberChannels: {
                email: false,
                linq: false,
                telegram: false,
              },
              userId: "member_123",
            },
            eventId: "evt_activation",
            occurredAt: "2026-04-08T00:15:00.000Z",
          }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
