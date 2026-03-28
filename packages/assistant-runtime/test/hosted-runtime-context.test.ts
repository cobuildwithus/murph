import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import { resolveAssistantStatePaths } from "@murph/runtime-state";

import {
  prepareHostedDispatchContext,
  reconcileHostedAssistantChannelCapabilities,
} from "../src/hosted-runtime/context.ts";

test("hosted channel capability reconciliation enables email and telegram auto-reply exactly once", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runtime-context-"));
  const vaultRoot = path.join(workspaceRoot, "vault");

  try {
    const firstResult = await reconcileHostedAssistantChannelCapabilities(vaultRoot, {
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });

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

    const secondResult = await reconcileHostedAssistantChannelCapabilities(vaultRoot, {
      HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
      HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });

    assert.deepEqual(secondResult, {
      emailAutoReplyEnabled: false,
      telegramAutoReplyEnabled: false,
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted dispatch context still requires member activation bootstrap before follow-up events", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runtime-context-"));
  const vaultRoot = path.join(workspaceRoot, "vault");

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
      emailAutoReplyEnabled: false,
      telegramAutoReplyEnabled: false,
      vaultCreated: true,
    });
    await access(path.join(vaultRoot, "vault.json"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("hosted dispatch context does not enable new auto-reply channels on non-activation follow-up events", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runtime-context-"));
  const vaultRoot = path.join(workspaceRoot, "vault");

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
      {
        HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID: "acct_123",
        HOSTED_EMAIL_CLOUDFLARE_API_TOKEN: "cf-token",
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
        TELEGRAM_BOT_TOKEN: "telegram-token",
      },
    );

    assert.deepEqual(
      JSON.parse(
        await readFile(resolveAssistantStatePaths(vaultRoot).automationPath, "utf8"),
      ).autoReplyChannels,
      [],
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
