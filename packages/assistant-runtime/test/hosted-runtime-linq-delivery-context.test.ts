import assert from "node:assert/strict";

import { describe, test } from "vitest";

import type {
  HostedAssistantLinqDeliveryContext,
} from "../src/hosted-runtime/linq-delivery-context.ts";
import {
  resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest,
} from "../src/hosted-runtime/linq-delivery-context.ts";

describe("hosted Linq delivery context selection", () => {
  test("prefers an exact reply target over an earlier same-chat context", () => {
    const older = buildLinqDeliveryContext({
      mailboxItemId: "mailbox_item_old",
      replyToMessageId: "linq_message_old",
      target: "linq_chat_same",
    });
    const current = buildLinqDeliveryContext({
      mailboxItemId: "mailbox_item_current",
      replyToMessageId: "linq_message_current",
      target: "linq_chat_same",
    });

    const resolved = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
      contexts: [older, current],
      replyToMessageId: "linq_message_current",
      target: "linq_chat_same",
      targetKind: "thread",
    });

    assert.equal(resolved?.currentInbound?.mailboxItemId, "mailbox_item_current");
  });

  test("falls back to target-only matching when no exact reply target is available", () => {
    const older = buildLinqDeliveryContext({
      mailboxItemId: "mailbox_item_old",
      replyToMessageId: "linq_message_old",
      target: "linq_chat_same",
    });

    const resolved = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
      contexts: [older],
      replyToMessageId: null,
      target: "linq_chat_same",
      targetKind: "thread",
    });

    assert.equal(resolved?.currentInbound?.mailboxItemId, "mailbox_item_old");
  });
});

function buildLinqDeliveryContext(input: {
  mailboxItemId: string;
  replyToMessageId: string;
  target: string;
}): HostedAssistantLinqDeliveryContext {
  return {
    currentInbound: {
      dedupeKey: `${input.mailboxItemId}:dedupe`,
      eventId: `${input.mailboxItemId}:event`,
      mailboxItemId: input.mailboxItemId,
      occurredAt: "2026-04-26T00:00:00.000Z",
      replyToMessageId: input.replyToMessageId,
      target: input.target,
    },
    directRecipientPhoneNumber: null,
    fromPhoneNumber: null,
    replyToMessageId: input.replyToMessageId,
    routeAuthority: null,
    service: "sms",
    target: input.target,
    threadIsDirect: false,
  };
}
