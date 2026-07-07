import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, test } from "vitest";

import {
  listAssistantInputEvents,
  readAssistantInputEvent,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import type {
  HostedExecutionGroupNewsletterEmailNeededWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

import {
  importHostedGroupNewsletterEmailNeededMailboxItem,
} from "../src/hosted-runtime/mailbox-group-newsletter-email-needed.ts";
import {
  createHostedMailboxRoutingPlan,
} from "../src/hosted-runtime/mailbox-routing.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_private_missing_email";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("hosted group newsletter email-needed mailbox import", () => {
  test("stages a redacted private system note on the member's own direct route", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-group-newsletter-email-needed-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const priorDirectInput = await upsertAssistantInputEvent({
      event: {
        content: {
          attachmentDescriptors: [],
          text: "prior direct message",
          transcriptText: "prior direct message",
          userMessageContent: [{ text: "prior direct message", type: "text" }],
        },
        conversation: {
          accountId: "acct_direct",
          actorId: "actor_member",
          actorIsSelf: false,
          source: "linq",
          threadId: "thread_direct",
          threadIsDirect: true,
        },
        occurredAt: "2026-04-25T20:00:00.000Z",
        replyTarget: {
          channel: "linq",
          messageId: "msg_prior_direct",
          threadId: "chat_direct",
        },
        sourceRef: {
          captureId: "capture_prior_direct",
          kind: "inbox-capture",
          source: "linq",
          version: null,
        },
      },
      vault: vaultRoot,
    });

    const outcome = await importHostedGroupNewsletterEmailNeededMailboxItem({
      item: createResolvedGroupNewsletterEmailNeededMailboxItem(),
      vaultRoot,
      wake: createGroupNewsletterEmailNeededWake(),
    });

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.reasonCode, "group-newsletter.email-needed.staged");
    assert.ok(outcome.assistantInputId);

    const staged = await readAssistantInputEvent({
      inputId: outcome.assistantInputId,
      vault: vaultRoot,
    });
    assert.ok(staged);
    assert.notEqual(staged.inputId, priorDirectInput.inputId);
    assert.deepEqual(staged.conversation, priorDirectInput.conversation);
    assert.deepEqual(staged.replyTarget, priorDirectInput.replyTarget);
    assert.equal(staged.sourceRef.kind, "hosted-mailbox");
    assert.equal(staged.sourceRef.lane, "system");
    assert.equal(staged.content.text, "System note: The group Tempo Crew set up an email newsletter. This member granted email sharing for that group but has no verified email. If appropriate, mention once in the normal 1:1 conversation that they can add an email at /settings?addEmail=true. Keep it casual, private, and non-shaming.");
    assert.equal(staged.content.text.includes(TEST_USER_ID), false);
    assert.equal(staged.content.text.includes("example.com"), false);
    assert.equal(staged.content.text.includes("sleep"), false);
    assert.equal(staged.content.text.includes("health"), false);

    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
      staged.inputId,
    ]);

    const listed = await listAssistantInputEvents({ vault: vaultRoot });
    assert.equal(listed.events.length, 2);
  });

  test("keeps durably consumed replays out of the pending assistant queue", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-group-newsletter-email-needed-replay-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    await seedPriorDirectInput(vaultRoot);

    const outcome = await importHostedGroupNewsletterEmailNeededMailboxItem({
      item: createResolvedGroupNewsletterEmailNeededMailboxItem({ durablyConsumed: true }),
      vaultRoot,
      wake: createGroupNewsletterEmailNeededWake(),
    });

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.reasonCode, "group-newsletter.email-needed.staged");
    assert.equal(outcome.assistantInputId, undefined);
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);

    const listed = await listAssistantInputEvents({ vault: vaultRoot });
    assert.equal(listed.events.length, 2);
  });
});

async function seedPriorDirectInput(vaultRoot: string): Promise<void> {
  await upsertAssistantInputEvent({
    event: {
      content: {
        attachmentDescriptors: [],
        text: "prior direct message",
        transcriptText: "prior direct message",
        userMessageContent: [{ text: "prior direct message", type: "text" }],
      },
      conversation: {
        accountId: "acct_direct",
        actorId: "actor_member",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_direct",
        threadIsDirect: true,
      },
      occurredAt: "2026-04-25T20:00:00.000Z",
      replyTarget: {
        channel: "linq",
        messageId: "msg_prior_direct",
        threadId: "chat_direct",
      },
      sourceRef: {
        captureId: "capture_prior_direct",
        kind: "inbox-capture",
        source: "linq",
        version: null,
      },
    },
    vault: vaultRoot,
  });
}

function createGroupNewsletterEmailNeededWake(): HostedExecutionGroupNewsletterEmailNeededWake {
  return {
    eventId: "group-newsletter.email-needed:member_private_missing_email:hgrp_private",
    groupDisplayName: "Tempo Crew",
    groupId: "hgrp_private",
    kind: "group-newsletter.email-needed",
    occurredAt: TEST_NOW,
    userId: TEST_USER_ID,
  };
}

function createResolvedGroupNewsletterEmailNeededMailboxItem(input: {
  durablyConsumed?: boolean;
} = {}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: TEST_NOW,
    dedupeKey: "group-newsletter.email-needed:member_private_missing_email:hgrp_private",
    expiresAt: null,
    id: "mailbox_item_group_newsletter_email_needed_001",
    kind: "group-newsletter.email-needed" as HostedMailboxItem["kind"],
    lane: "system",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_inline_synthetic",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
  };
  const route = createHostedMailboxRoutingPlan(item);
  if (route.state !== "route") {
    throw new Error("Expected routed group-newsletter email-needed mailbox item.");
  }

  return {
    ...(input.durablyConsumed === true ? { durablyConsumed: true } : {}),
    item,
    payload: {
      payloadCiphertext: item.payloadInlineCiphertext ?? "ciphertext_sidecar_synthetic",
      payloadSchema: item.payloadSchema,
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route,
  };
}
