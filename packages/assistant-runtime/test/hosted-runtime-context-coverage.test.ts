import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import type {
  AssistantInputCursor,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

const mocks = vi.hoisted(() => ({
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  ensureHostedAssistantOperatorDefaults: vi.fn(),
  inboxInit: vi.fn(),
  inboxList: vi.fn(),
  readOperatorConfig: vi.fn(),
  resolveHostedAssistantConfig: vi.fn(),
  resolveHostedAssistantOperatorDefaultsState: vi.fn(),
  vaultInit: vi.fn(),
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
  ensureHostedInboxSidecarReady,
  invalidateHostedInboxSidecarReady,
  isHostedInboxSidecarReady,
  prepareHostedWakeContext,
  prepareHostedInboxProjectionRuntime,
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
  mocks.inboxInit.mockResolvedValue(undefined);
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
      enabledAt: string;
      eligibleAfter: AssistantInputCursor | null;
    }>;
    updatedAt: string;
    version: number;
  };
}

async function writeAutomationState(
  vaultRoot: string,
  state: {
    autoReply: Array<{
      channel: string;
      enabledAt: string;
      eligibleAfter: AssistantInputCursor | null;
    }>;
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

function summarizeAutoReply(
  state: Awaited<ReturnType<typeof readAutomationState>>,
): Array<{
  channel: string;
  eligibleAfter: AssistantInputCursor | null;
}> {
  return state.autoReply.map((entry) => ({
    channel: entry.channel,
    eligibleAfter: entry.eligibleAfter,
  }));
}

function testAssistantInputCursor(input: {
  createdAt?: string | null;
  inputId: string;
  occurredAt: string;
  sourceKind?: AssistantInputCursor["sourceKind"];
  sourcePosition?: string | null;
}): AssistantInputCursor {
  return {
    createdAt: input.createdAt ?? null,
    inputId: input.inputId,
    occurredAt: input.occurredAt,
    sourceKind: input.sourceKind ?? "inbox-capture",
    ...(input.sourcePosition !== undefined
      ? { sourcePosition: input.sourcePosition }
      : {}),
  };
}

async function stageHostedAssistantInput(input: {
  createdAt: string;
  eventId: string;
  laneSeq: string;
  occurredAt: string;
  vault: string;
}) {
  return upsertAssistantInputEvent({
    now: new Date(input.createdAt),
    vault: input.vault,
    event: {
      content: {
        text: "latest hosted message",
        transcriptText: "latest hosted message",
        userMessageContent: [
          {
            text: "latest hosted message",
            type: "text",
          },
        ],
      },
      conversation: {
        accountId: "account_1",
        actorId: "actor_1",
        actorIsSelf: false,
        source: "email",
        threadId: "thread_1",
        threadIsDirect: true,
      },
      occurredAt: input.occurredAt,
      receivedAt: input.createdAt,
      sourceRef: {
        dedupeKey: `dedupe_${input.eventId}`,
        eventId: input.eventId,
        itemId: `item_${input.eventId}`,
        kind: "hosted-mailbox",
        lane: "conversation",
        laneSeq: input.laneSeq,
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        payloadSource: "inline",
        source: "hosted-mailbox",
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    },
  });
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
            whatsappCloudApiConfigured: false,
          },
        }),
      );

      assert.equal(result, null);
      expect(mocks.inboxList).not.toHaveBeenCalled();
      expect(mocks.vaultInit).not.toHaveBeenCalled();
      expect(mocks.inboxInit).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("passes the restored operator home to hosted assistant bootstrap before mailbox execution", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();
    const previousHome = process.env.HOME;

    try {
      await writeFile(path.join(vaultRoot, "vault.json"), "{}", "utf8");
      const parentRoot = path.dirname(vaultRoot);
      const ambientHomeRoot = path.join(parentRoot, "ambient-home");
      const operatorHomeRoot = path.join(parentRoot, "operator-home");
      await Promise.all([
        mkdir(ambientHomeRoot, { recursive: true }),
        mkdir(operatorHomeRoot, { recursive: true }),
      ]);
      process.env.HOME = ambientHomeRoot;
      const runtimeEnv = {
        HOSTED_ASSISTANT_MODEL: "gpt-5.4",
        HOSTED_ASSISTANT_PROVIDER: "openai",
      };

      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "device-sync.wake",
            reason: "connected",
            userId: "member_123",
          },
          eventId: "evt_operator_home",
          occurredAt: "2026-04-08T00:00:00.000Z",
        }),
        runtimeEnv,
        createHostedRuntimeResolvedConfig(),
        {
          operatorHomeRoot,
        },
      );

      expect(mocks.ensureHostedAssistantOperatorDefaults).toHaveBeenCalledWith({
        allowMissing: true,
        env: runtimeEnv,
        homeDirectory: operatorHomeRoot,
      });
      expect(mocks.ensureHostedAssistantOperatorDefaults).not.toHaveBeenCalledWith(
        expect.objectContaining({
          homeDirectory: ambientHomeRoot,
        }),
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
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
            whatsappCloudApiConfigured: false,
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
        autoReply: [
          {
            channel: "email",
            enabledAt: "2026-04-08T00:05:00.000Z",
            eligibleAfter: testAssistantInputCursor({
              inputId: "ain_000000000000000000000000000000e1",
              occurredAt: "2026-04-08T00:00:00.000Z",
            }),
          },
          {
            channel: "linq",
            enabledAt: "2026-04-08T00:05:00.000Z",
            eligibleAfter: null,
          },
          {
            channel: "telegram",
            enabledAt: "2026-04-08T00:05:00.000Z",
            eligibleAfter: testAssistantInputCursor({
              inputId: "ain_000000000000000000000000000000e2",
              occurredAt: "2026-04-08T00:01:00.000Z",
            }),
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
            whatsappCloudApiConfigured: false,
          },
          true,
        ),
      ).resolves.toEqual({
        emailAutoReplyEnabled: true,
        linqAutoReplyEnabled: true,
        telegramAutoReplyEnabled: true,
      });

      const state = await readAutomationState(vaultRoot);
      assert.deepEqual(state, {
        version: 1,
        autoReply: [
          {
            channel: "email",
            enabledAt: "2026-04-08T00:05:00.000Z",
            eligibleAfter: testAssistantInputCursor({
              inputId: "ain_000000000000000000000000000000e1",
              occurredAt: "2026-04-08T00:00:00.000Z",
            }),
          },
          {
            channel: "linq",
            enabledAt: "2026-04-08T00:05:00.000Z",
            eligibleAfter: null,
          },
          {
            channel: "telegram",
            enabledAt: "2026-04-08T00:05:00.000Z",
            eligibleAfter: testAssistantInputCursor({
              inputId: "ain_000000000000000000000000000000e2",
              occurredAt: "2026-04-08T00:01:00.000Z",
            }),
          },
        ],
        updatedAt: "2026-04-08T00:05:00.000Z",
      });
      expect(mocks.inboxList).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("does not seed past staged assistant input when enabling a hosted channel", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await writeAutomationState(vaultRoot, {
        version: 1,
        autoReply: [
          {
            channel: "linq",
            enabledAt: "2026-04-08T00:05:00.000Z",
            eligibleAfter: testAssistantInputCursor({
              inputId: "ain_000000000000000000000000000000f1",
              occurredAt: "2026-04-08T00:00:00.000Z",
            }),
          },
        ],
        updatedAt: "2026-04-08T00:05:00.000Z",
      });
      const latest = await stageHostedAssistantInput({
        createdAt: "2026-04-08T00:09:01.000Z",
        eventId: "event_latest_projection_failed",
        laneSeq: "9",
        occurredAt: "2026-04-08T00:09:00.000Z",
        vault: vaultRoot,
      });
      await updateAssistantInputProjection({
        inputId: latest.inputId,
        projection: {
          lastAttemptedAt: "2026-04-08T00:09:02.000Z",
          reasonCode: "projection.failed",
          status: "failed",
        },
        vault: vaultRoot,
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
            whatsappCloudApiConfigured: false,
          },
          true,
        ),
      ).resolves.toEqual({
        emailAutoReplyEnabled: true,
        linqAutoReplyEnabled: true,
        telegramAutoReplyEnabled: false,
      });

      const state = await readAutomationState(vaultRoot);
      assert.deepEqual(summarizeAutoReply(state), [
        {
          channel: "email",
          eligibleAfter: null,
        },
        {
          channel: "linq",
          eligibleAfter: testAssistantInputCursor({
            inputId: "ain_000000000000000000000000000000f1",
            occurredAt: "2026-04-08T00:00:00.000Z",
          }),
        },
      ]);
      assert.equal(state.version, 1);
      expect(mocks.inboxList).not.toHaveBeenCalled();
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

  it("initializes hosted inbox sidecar with rebuild and makes later projection init cheap", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await expect(
        ensureHostedInboxSidecarReady({
          bestEffort: false,
          rebuild: true,
          requestId: "req_startup_sidecar",
          vaultRoot,
        }),
      ).resolves.toBe(true);

      await prepareHostedInboxProjectionRuntime(vaultRoot, "req_projection_sidecar");

      expect(mocks.createIntegratedInboxServices).toHaveBeenCalledTimes(2);
      expect(mocks.inboxInit).toHaveBeenNthCalledWith(1, {
        rebuild: true,
        rebuildParserJobs: false,
        requestId: "req_startup_sidecar",
        vault: vaultRoot,
      });
      expect(mocks.inboxInit).toHaveBeenNthCalledWith(2, {
        rebuild: false,
        rebuildParserJobs: false,
        requestId: "req_projection_sidecar",
        vault: vaultRoot,
      });
      expect(isHostedInboxSidecarReady(vaultRoot)).toBe(true);
      expect(isHostedInboxSidecarReady(path.join(vaultRoot, "..", path.basename(vaultRoot)))).toBe(true);
      invalidateHostedInboxSidecarReady(path.join(vaultRoot, "..", path.basename(vaultRoot)));
      expect(isHostedInboxSidecarReady(vaultRoot)).toBe(false);
      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "hosted.inbox",
          details: expect.objectContaining({
            ready: true,
            rebuild: true,
            requestId: "req_startup_sidecar",
            elapsedMs: expect.any(Number),
          }),
          level: "info",
          message: "Hosted inbox sidecar bootstrap finished.",
        }),
      );
    } finally {
      await cleanup();
    }
  });

  it("uses rebuild for projection init when startup sidecar bootstrap was skipped", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();

    try {
      await prepareHostedInboxProjectionRuntime(vaultRoot, "req_projection_without_startup");

      expect(mocks.inboxInit).toHaveBeenCalledWith({
        rebuild: true,
        rebuildParserJobs: false,
        requestId: "req_projection_without_startup",
        vault: vaultRoot,
      });
    } finally {
      await cleanup();
    }
  });

  it("logs sanitized best-effort hosted inbox sidecar bootstrap failures", async () => {
    const { cleanup, vaultRoot } = await createWorkspace();
    const sensitiveErrorMessage =
      "failed rebuilding capture cap_private_attachment_001 from raw/inbox/private-labs.pdf";
    mocks.inboxInit.mockRejectedValueOnce(
      new Error(sensitiveErrorMessage),
    );

    try {
      await expect(
        ensureHostedInboxSidecarReady({
          bestEffort: true,
          rebuild: true,
          requestId: "req_startup_sidecar_failed",
          vaultRoot,
        }),
      ).resolves.toBe(false);

      expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "hosted.inbox",
          details: expect.objectContaining({
            errorMessage: "hosted_inbox_sidecar_bootstrap_failed",
            elapsedMs: expect.any(Number),
            ready: false,
            rebuild: true,
            requestId: "req_startup_sidecar_failed",
          }),
          level: "warn",
          message: "Hosted inbox sidecar bootstrap failed; continuing best-effort.",
        }),
      );
      expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls)).not.toContain(
        sensitiveErrorMessage,
      );
    } finally {
      await cleanup();
    }
  });

});
