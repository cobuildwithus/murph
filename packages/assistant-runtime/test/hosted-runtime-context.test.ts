import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, test, vi } from "vitest";

import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

const mocks = vi.hoisted(() => ({
  inboxInit: vi.fn(),
  inboxList: vi.fn(),
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
        async init(input: { vault: string }) {
          await mkdir(input.vault, { recursive: true });
          await writeFile(path.join(input.vault, "vault.json"), "{}", "utf8");
        },
      },
    };
  },
}));

import {
  prepareHostedDispatchContext,
  reconcileHostedAssistantChannelCapabilities,
} from "../src/hosted-runtime/context.ts";
import {
  createHostedRuntimeWorkspace,
  HOSTED_RUNTIME_RESOLVED_CONFIG,
  HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV,
} from "./hosted-runtime-test-helpers.ts";

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
      cursor: { captureId: string; occurredAt: string } | null;
    }>;
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
) {
  const automationStatePath = resolveAssistantStatePaths(vaultRoot).automationStatePath;
  await mkdir(path.dirname(automationStatePath), { recursive: true });
  await writeFile(automationStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

test("hosted channel capability reconciliation enables email and telegram auto-reply exactly once", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    const firstResult = await reconcileHostedAssistantChannelCapabilities(
      vaultRoot,
      HOSTED_RUNTIME_RESOLVED_CONFIG.channelCapabilities,
      true,
    );

    assert.deepEqual(firstResult, {
      emailAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
    assert.deepEqual((await readAutomationState(vaultRoot)).autoReply, [
      {
        channel: "email",
        cursor: null,
      },
      {
        channel: "telegram",
        cursor: null,
      },
    ]);

    const secondResult = await reconcileHostedAssistantChannelCapabilities(
      vaultRoot,
      HOSTED_RUNTIME_RESOLVED_CONFIG.channelCapabilities,
      true,
    );

    assert.deepEqual(secondResult, {
      emailAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
    assert.equal(mocks.inboxList.mock.calls.length, 1);
  } finally {
    await cleanup();
  }
});

test("hosted channel capability reconciliation preserves unmanaged entries while pruning disabled hosted channels", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await writeAutomationState(vaultRoot, {
      version: 1,
      inboxScanCursor: null,
      autoReply: [
        {
          channel: "email",
          cursor: {
            captureId: "cap_email",
            occurredAt: "2026-03-28T09:00:00.000Z",
          },
        },
        {
          channel: "linq",
          cursor: {
            captureId: "cap_linq",
            occurredAt: "2026-03-28T09:01:00.000Z",
          },
        },
        {
          channel: "telegram",
          cursor: {
            captureId: "cap_telegram",
            occurredAt: "2026-03-28T09:02:00.000Z",
          },
        },
      ],
      updatedAt: "2026-03-28T09:03:00.000Z",
    });

    const result = await reconcileHostedAssistantChannelCapabilities(
      vaultRoot,
      {
        emailSendReady: false,
        telegramBotConfigured: true,
      },
      true,
    );

    assert.deepEqual(result, {
      emailAutoReplyEnabled: false,
      telegramAutoReplyEnabled: true,
    });
    assert.deepEqual((await readAutomationState(vaultRoot)).autoReply, [
      {
        channel: "linq",
        cursor: {
          captureId: "cap_linq",
          occurredAt: "2026-03-28T09:01:00.000Z",
        },
      },
      {
        channel: "telegram",
        cursor: {
          captureId: "cap_telegram",
          occurredAt: "2026-03-28T09:02:00.000Z",
        },
      },
    ]);
    assert.equal(mocks.inboxList.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("hosted dispatch context still requires member activation bootstrap before follow-up events", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await assert.rejects(
      prepareHostedDispatchContext(
        vaultRoot,
        {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_123",
          },
          eventId: "evt_tick_without_bootstrap",
          occurredAt: "2026-03-28T09:00:00.000Z",
        },
        {},
        HOSTED_RUNTIME_RESOLVED_CONFIG,
      ),
      /requires member\.activated bootstrap first/u,
    );

    const bootstrapResult = await prepareHostedDispatchContext(
      vaultRoot,
      {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation",
        occurredAt: "2026-03-28T09:05:00.000Z",
      },
      {},
      HOSTED_RUNTIME_RESOLVED_CONFIG,
    );

    assert.deepEqual(bootstrapResult, {
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
      assistantSeeded: false,
      emailAutoReplyEnabled: false,
      telegramAutoReplyEnabled: false,
      vaultCreated: true,
    });
    await access(path.join(vaultRoot, "vault.json"));
  } finally {
    await cleanup();
  }
});

test("hosted dispatch context does not enable new auto-reply channels on non-activation follow-up events", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    await prepareHostedDispatchContext(
      vaultRoot,
      {
        event: {
          kind: "member.activated",
          userId: "member_123",
        },
        eventId: "evt_activation",
        occurredAt: "2026-03-28T09:05:00.000Z",
      },
      {},
      HOSTED_RUNTIME_RESOLVED_CONFIG,
    );

    await prepareHostedDispatchContext(
      vaultRoot,
      {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_tick_after_bootstrap",
        occurredAt: "2026-03-28T09:10:00.000Z",
      },
      HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV,
      HOSTED_RUNTIME_RESOLVED_CONFIG,
    );

    assert.deepEqual((await readAutomationState(vaultRoot)).autoReply, []);
  } finally {
    await cleanup();
  }
});
