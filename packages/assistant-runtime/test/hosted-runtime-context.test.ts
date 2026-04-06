import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { test } from "vitest";

import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

import {
  prepareHostedDispatchContext,
  reconcileHostedAssistantChannelCapabilities,
} from "../src/hosted-runtime/context.ts";
import {
  createHostedRuntimeWorkspace,
  HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV,
} from "./hosted-runtime-test-helpers.ts";

test("hosted channel capability reconciliation enables email and telegram auto-reply exactly once", async () => {
  const { cleanup, vaultRoot } = await createHostedRuntimeWorkspace("hosted-runtime-context-");

  try {
    const firstResult = await reconcileHostedAssistantChannelCapabilities(
      vaultRoot,
      HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV,
      true,
    );

    assert.deepEqual(firstResult, {
      emailAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
    assert.deepEqual(
      JSON.parse(
        await readFile(resolveAssistantStatePaths(vaultRoot).automationPath, "utf8"),
      ).autoReplyChannels,
      ["email", "telegram"],
    );

    const secondResult = await reconcileHostedAssistantChannelCapabilities(
      vaultRoot,
      HOSTED_RUNTIME_EMAIL_CAPABILITY_ENV,
      true,
    );

    assert.deepEqual(secondResult, {
      emailAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
    });
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
    );

    const automationState = JSON.parse(
      await readFile(resolveAssistantStatePaths(vaultRoot).automationPath, "utf8"),
    ) as { autoReplyChannels: string[] };

    assert.deepEqual(automationState.autoReplyChannels, []);
  } finally {
    await cleanup();
  }
});
