import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, test, vi } from "vitest";

import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import type {
  AssistantInputCursor,
} from "@murphai/operator-config/assistant-cli-contracts";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

const mocks = vi.hoisted(() => ({
  inboxInit: vi.fn(),
  inboxList: vi.fn(),
  vaultInit: vi.fn(),
}));

vi.mock("@murphai/inbox-services", () => ({
  createIntegratedInboxServices() {
    return {
      init: mocks.inboxInit,
      list: mocks.inboxList,
    };
  },
}));

vi.mock("@murphai/vault-usecases/vault-services", () => ({
  createIntegratedVaultServices() {
    return {
      core: {
        async init(input: { timezone?: string; vault: string }) {
          mocks.vaultInit(input);
          await mkdir(input.vault, { recursive: true });
          await writeFile(path.join(input.vault, "vault.json"), "{}", "utf8");
        },
      },
    };
  },
}));

import {
  prepareHostedWakeContext,
  readHostedAssistantExecutionDefaultTarget,
  reconcileHostedAssistantChannelState,
} from "../src/hosted-runtime/context.ts";
import {
  createHostedRuntimeWorkspace,
  HOSTED_RUNTIME_RESOLVED_CONFIG,
  HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV,
} from "./hosted-runtime-test-helpers.ts";

const DEFAULT_MEMBER_CHANNELS = {
  email: true,
  linq: true,
  telegram: true,
} as const;
const HOSTED_ASSISTANT_SEED_ENV = {
  HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
  HOSTED_ASSISTANT_MODEL: "gpt-5.5",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
  HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
} as const;
const HOSTED_CODEX_VERCEL_GATEWAY_TARGET = {
  adapter: "codex-cli",
  approvalPolicy: "never",
  codexCommand: null,
  model: "gpt-5.5",
  modelProvider: "openai",
  oss: false,
  profile: null,
  reasoningEffort: "medium",
  sandbox: "danger-full-access",
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
        timeZone: typeof input.event.timeZone === "string"
          ? input.event.timeZone
          : null,
      });
    case "conversation.message":
      return buildHostedExecutionLinqConversationMessageWake({
        eventId: input.eventId,
        linqMessage: input.event.linqMessage as Parameters<
          typeof buildHostedExecutionLinqConversationMessageWake
        >[0]["linqMessage"],
        occurredAt: input.occurredAt,
        phoneLookupKey: input.event.phoneLookupKey as string,
        userId: input.event.userId ?? "member_123",
      });
    default:
      throw new Error(`Unsupported wake kind: ${input.event.kind}`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inboxList.mockResolvedValue({
    items: [],
  });
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
) {
  const automationStatePath = resolveAssistantStatePaths(vaultRoot).automationStatePath;
  await mkdir(path.dirname(automationStatePath), { recursive: true });
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
  inputId: string;
  occurredAt: string;
}): AssistantInputCursor {
  return {
    createdAt: null,
    inputId: input.inputId,
    occurredAt: input.occurredAt,
    sourceKind: "inbox-capture",
  };
}

function setHostedAssistantSeedEnv(): Record<string, string | undefined> {
  const previousEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(HOSTED_ASSISTANT_SEED_ENV)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  return previousEnv;
}

function buildHostedAssistantSeedRuntimeEnv(): Record<string, string> {
  return { ...HOSTED_ASSISTANT_SEED_ENV };
}

function restoreHostedAssistantSeedEnv(previousEnv: Record<string, string | undefined>): void {
  for (const key of Object.keys(HOSTED_ASSISTANT_SEED_ENV)) {
    const value = previousEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function withOperatorHomeRoot<T>(
  operatorHomeRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const previousHome = process.env.HOME;

  process.env.HOME = operatorHomeRoot;

  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

test("hosted channel state reconciliation enables linked hosted auto-reply channels exactly once", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    const firstResult = await reconcileHostedAssistantChannelState(
      vaultRoot,
      DEFAULT_MEMBER_CHANNELS,
      HOSTED_RUNTIME_RESOLVED_CONFIG.channelCapabilities,
      true,
    );

    assert.deepEqual(firstResult, {
      emailAutoReplyEnabled: true,
      linqAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
    assert.deepEqual(summarizeAutoReply(await readAutomationState(vaultRoot)), [
      {
        channel: "email",
        eligibleAfter: null,
      },
      {
        channel: "linq",
        eligibleAfter: null,
      },
      {
        channel: "telegram",
        eligibleAfter: null,
      },
    ]);

    const secondResult = await reconcileHostedAssistantChannelState(
      vaultRoot,
      DEFAULT_MEMBER_CHANNELS,
      HOSTED_RUNTIME_RESOLVED_CONFIG.channelCapabilities,
      true,
    );

    assert.deepEqual(secondResult, {
      emailAutoReplyEnabled: true,
      linqAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
    assert.equal(mocks.inboxList.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("hosted channel state reconciliation preserves unmanaged entries while pruning unlinked or unavailable hosted channels", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await writeAutomationState(vaultRoot, {
      version: 1,
      autoReply: [
        {
          channel: "email",
          enabledAt: "2026-03-28T09:03:00.000Z",
          eligibleAfter: testAssistantInputCursor({
            inputId: "ain_000000000000000000000000000000a1",
            occurredAt: "2026-03-28T09:00:00.000Z",
          }),
        },
        {
          channel: "linq",
          enabledAt: "2026-03-28T09:03:00.000Z",
          eligibleAfter: testAssistantInputCursor({
            inputId: "ain_000000000000000000000000000000a2",
            occurredAt: "2026-03-28T09:01:00.000Z",
          }),
        },
        {
          channel: "telegram",
          enabledAt: "2026-03-28T09:03:00.000Z",
          eligibleAfter: testAssistantInputCursor({
            inputId: "ain_000000000000000000000000000000a3",
            occurredAt: "2026-03-28T09:02:00.000Z",
          }),
        },
      ],
      updatedAt: "2026-03-28T09:03:00.000Z",
    });

    const result = await reconcileHostedAssistantChannelState(
      vaultRoot,
      {
        email: false,
        linq: true,
        telegram: true,
      },
      {
        emailSendReady: false,
        telegramBotConfigured: true,
      },
      true,
    );

    assert.deepEqual(result, {
      emailAutoReplyEnabled: false,
      linqAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
    assert.deepEqual(summarizeAutoReply(await readAutomationState(vaultRoot)), [
      {
        channel: "linq",
        eligibleAfter: testAssistantInputCursor({
          inputId: "ain_000000000000000000000000000000a2",
          occurredAt: "2026-03-28T09:01:00.000Z",
        }),
      },
      {
        channel: "telegram",
        eligibleAfter: testAssistantInputCursor({
          inputId: "ain_000000000000000000000000000000a3",
          occurredAt: "2026-03-28T09:02:00.000Z",
        }),
      },
    ]);
    assert.equal(mocks.inboxList.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("hosted wake context still requires member activation bootstrap before follow-up events", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await assert.rejects(
        prepareHostedWakeContext(
          vaultRoot,
          buildLegacyWake({
            event: {
              kind: "device-sync.wake",
              reason: "connected",
              userId: "member_123",
            },
            eventId: "evt_tick_without_bootstrap",
            occurredAt: "2026-03-28T09:00:00.000Z",
          }),
          {},
          HOSTED_RUNTIME_RESOLVED_CONFIG,
        ),
        /requires member\.activated bootstrap first/u,
      );

      const bootstrapResult = await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            memberChannels: {
              email: false,
              linq: false,
              telegram: false,
            },
            timeZone: "America/New_York",
            userId: "member_123",
          },
          eventId: "evt_activation",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        {},
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      assert.deepEqual(bootstrapResult, {
        assistantActiveProfileId: null,
        assistantActiveProfileManagedBy: null,
        assistantActiveProfileReady: false,
        assistantConfigInvalid: false,
        assistantConfigPresent: false,
        assistantConfigStatus: "missing",
        assistantConfigured: false,
        assistantProvider: null,
        assistantSeeded: false,
        emailAutoReplyEnabled: false,
        linqAutoReplyEnabled: false,
        telegramAutoReplyEnabled: false,
        vaultCreated: true,
      });
    });
    await access(path.join(vaultRoot, "vault.json"));
    assert.equal(mocks.vaultInit.mock.calls[0]?.[0]?.timezone, "America/New_York");
  } finally {
    await cleanup();
  }
});

test("hosted member activation enables managed Linq auto-reply when first contact is Linq and the hosted assistant is configured", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");
  const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      const bootstrapResult = await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            firstContact: {
              channel: "linq",
              identityId: "hbidx:phone:v1:test",
              threadId: "chat_123",
              threadIsDirect: true,
            },
            memberChannels: DEFAULT_MEMBER_CHANNELS,
            userId: "member_123",
          },
          eventId: "evt_activation_linq",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      assert.deepEqual(bootstrapResult, {
        assistantActiveProfileId: null,
        assistantActiveProfileManagedBy: null,
        assistantActiveProfileReady: true,
        assistantConfigInvalid: false,
        assistantConfigPresent: true,
        assistantConfigStatus: "hosted-env",
        assistantConfigured: true,
        assistantProvider: "codex-cli",
        assistantSeeded: true,
        emailAutoReplyEnabled: true,
        linqAutoReplyEnabled: true,
        telegramAutoReplyEnabled: true,
        vaultCreated: true,
      });
    });
    assert.deepEqual(summarizeAutoReply(await readAutomationState(vaultRoot)), [
      {
        channel: "email",
        eligibleAfter: null,
      },
      {
        channel: "linq",
        eligibleAfter: null,
      },
      {
        channel: "telegram",
        eligibleAfter: null,
      },
    ]);
  } finally {
    restoreHostedAssistantSeedEnv(previousHostedAssistantEnv);
    await cleanup();
  }
});

test("hosted member activation uses New York vault timezone fallback when no signup hint is present", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            memberChannels: DEFAULT_MEMBER_CHANNELS,
            userId: "member_123",
          },
          eventId: "evt_activation_no_timezone",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        {},
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );
    });

    assert.equal(mocks.vaultInit.mock.calls[0]?.[0]?.timezone, "America/New_York");
  } finally {
    await cleanup();
  }
});

test("hosted member activation preserves an explicit signup timezone hint", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            memberChannels: DEFAULT_MEMBER_CHANNELS,
            timeZone: "UTC",
            userId: "member_123",
          },
          eventId: "evt_activation_explicit_utc",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        {},
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );
    });

    assert.equal(mocks.vaultInit.mock.calls[0]?.[0]?.timezone, "UTC");
  } finally {
    await cleanup();
  }
});

test("hosted assistant bootstrap exposes an execution default target for later maintenance turns", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");
  const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            memberChannels: DEFAULT_MEMBER_CHANNELS,
            userId: "member_123",
          },
          eventId: "evt_activation_default_target",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      const defaultTarget = await readHostedAssistantExecutionDefaultTarget();

      assert.deepEqual(defaultTarget, HOSTED_CODEX_VERCEL_GATEWAY_TARGET);
    });
  } finally {
    restoreHostedAssistantSeedEnv(previousHostedAssistantEnv);
    await cleanup();
  }
});

test("hosted activation replay preserves managed Linq auto-reply after Linq bootstrap", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");
  const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            firstContact: {
              channel: "linq",
              identityId: "hbidx:phone:v1:test",
              threadId: "chat_123",
              threadIsDirect: true,
            },
            memberChannels: DEFAULT_MEMBER_CHANNELS,
            userId: "member_123",
          },
          eventId: "evt_activation_linq_initial",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            memberChannels: DEFAULT_MEMBER_CHANNELS,
            userId: "member_123",
          },
          eventId: "evt_activation_linq_replay",
          occurredAt: "2026-03-28T09:10:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );
    });

    assert.deepEqual(summarizeAutoReply(await readAutomationState(vaultRoot)), [
      {
        channel: "email",
        eligibleAfter: null,
      },
      {
        channel: "linq",
        eligibleAfter: null,
      },
      {
        channel: "telegram",
        eligibleAfter: null,
      },
    ]);
  } finally {
    restoreHostedAssistantSeedEnv(previousHostedAssistantEnv);
    await cleanup();
  }
});

test("hosted Linq inbound wake self-heals managed Linq auto-reply when the hosted assistant is configured", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");
  const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
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
          eventId: "evt_activation_without_channels",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      assert.deepEqual((await readAutomationState(vaultRoot)).autoReply, []);

      const result = await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "conversation.message",
            linqMessage: {
              chatId: "chat_123",
              from: "+15551234567",
              isFromMe: false,
              messageId: "msg_123",
              parts: [],
            },
            phoneLookupKey: "phone_lookup_key",
            userId: "member_123",
          },
          eventId: "evt_linq_message_received",
          occurredAt: "2026-03-28T09:10:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      assert.equal(result, null);
    });

    assert.deepEqual(summarizeAutoReply(await readAutomationState(vaultRoot)), [
      {
        channel: "linq",
        eligibleAfter: null,
      },
    ]);
  } finally {
    restoreHostedAssistantSeedEnv(previousHostedAssistantEnv);
    await cleanup();
  }
});

test("hosted Linq inbound wake self-heal preserves existing managed channels", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");
  const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "member.activated",
            memberChannels: {
              email: true,
              linq: false,
              telegram: false,
            },
            userId: "member_123",
          },
          eventId: "evt_activation_email_only",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      const result = await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "conversation.message",
            linqMessage: {
              chatId: "chat_123",
              from: "+15551234567",
              isFromMe: false,
              messageId: "msg_123",
              parts: [],
            },
            phoneLookupKey: "phone_lookup_key",
            userId: "member_123",
          },
          eventId: "evt_linq_message_received",
          occurredAt: "2026-03-28T09:10:00.000Z",
        }),
        buildHostedAssistantSeedRuntimeEnv(),
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      assert.equal(result, null);
    });

    assert.deepEqual(summarizeAutoReply(await readAutomationState(vaultRoot)), [
      {
        channel: "email",
        eligibleAfter: null,
      },
      {
        channel: "linq",
        eligibleAfter: null,
      },
    ]);
  } finally {
    restoreHostedAssistantSeedEnv(previousHostedAssistantEnv);
    await cleanup();
  }
});

test("hosted Linq inbound wake self-heal does not enable auto-reply when the hosted assistant is not configured", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
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
          eventId: "evt_activation_without_config",
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        {},
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      const result = await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
            kind: "conversation.message",
            linqMessage: {
              chatId: "chat_123",
              from: "+15551234567",
              isFromMe: false,
              messageId: "msg_123",
              parts: [],
            },
            phoneLookupKey: "phone_lookup_key",
            userId: "member_123",
          },
          eventId: "evt_linq_message_received_without_config",
          occurredAt: "2026-03-28T09:10:00.000Z",
        }),
        {},
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      assert.equal(result, null);
    });

    assert.deepEqual((await readAutomationState(vaultRoot)).autoReply, []);
  } finally {
    await cleanup();
  }
});

test("hosted wake context does not change auto-reply state on non-channel follow-up events", async () => {
  const { cleanup, operatorHomeRoot, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await withOperatorHomeRoot(operatorHomeRoot, async () => {
      await prepareHostedWakeContext(
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
          occurredAt: "2026-03-28T09:05:00.000Z",
        }),
        {},
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );
      const autoReplyAfterActivation = (await readAutomationState(vaultRoot)).autoReply;

      await prepareHostedWakeContext(
        vaultRoot,
        buildLegacyWake({
          event: {
              kind: "device-sync.wake",
              reason: "connected",
              userId: "member_123",
            },
          eventId: "evt_tick_after_bootstrap",
          occurredAt: "2026-03-28T09:10:00.000Z",
        }),
        HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV,
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      );

      assert.deepEqual((await readAutomationState(vaultRoot)).autoReply, autoReplyAfterActivation);
    });
  } finally {
    await cleanup();
  }
});
