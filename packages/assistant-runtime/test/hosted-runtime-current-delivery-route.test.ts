import assert from "node:assert/strict";

import { test } from "vitest";

import {
  readHostedAssistantInputCurrentDeliveryRoute,
  resolveUnambiguousCurrentDeliveryRoute,
} from "../src/hosted-runtime/current-delivery-route.ts";

test("hosted current route keeps reply target delivery separate from conversation locators", () => {
  assert.deepEqual(
    readHostedAssistantInputCurrentDeliveryRoute({
      conversation: {
        accountId: "h1_111111111111111111111111",
        actorId: "h1_222222222222222222222222",
        actorIsSelf: false,
        source: "linq",
        threadId: "h1_333333333333333333333333",
        threadIsDirect: false,
      },
      replyTarget: {
        channel: "linq",
        messageId: "linq_message_real",
        threadId: "linq_chat_real",
      },
    }),
    {
      channel: "linq",
      deliveryTarget: "linq_chat_real",
      identityId: "h1_111111111111111111111111",
      participantId: "h1_222222222222222222222222",
      threadId: "h1_333333333333333333333333",
    },
  );
});

test("hosted current route ignores conversation locators for a different channel", () => {
  assert.deepEqual(
    readHostedAssistantInputCurrentDeliveryRoute({
      conversation: {
        accountId: "h1_111111111111111111111111",
        actorId: "h1_222222222222222222222222",
        actorIsSelf: false,
        source: "telegram",
        threadId: "h1_333333333333333333333333",
        threadIsDirect: false,
      },
      replyTarget: {
        channel: "linq",
        messageId: "linq_message_real",
        threadId: "linq_chat_real",
      },
    }),
    {
      channel: "linq",
      deliveryTarget: "linq_chat_real",
      identityId: null,
      participantId: null,
      threadId: null,
    },
  );
});

test("unambiguous current route keeps locators when every message agrees", () => {
  const route = {
    channel: "linq",
    deliveryTarget: "linq_chat_real",
    identityId: "h1_111111111111111111111111",
    participantId: "h1_222222222222222222222222",
    threadId: "h1_333333333333333333333333",
  };
  assert.deepEqual(resolveUnambiguousCurrentDeliveryRoute([route, route]), route);
});

test("unambiguous current route resolves one conversation with disagreeing senders", () => {
  assert.deepEqual(
    resolveUnambiguousCurrentDeliveryRoute([
      {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "h1_111111111111111111111111",
        participantId: "h1_222222222222222222222222",
        threadId: "h1_333333333333333333333333",
      },
      {
        channel: "linq",
        deliveryTarget: "linq_chat_real",
        identityId: "h1_111111111111111111111111",
        participantId: "h1_444444444444444444444444",
        threadId: "h1_333333333333333333333333",
      },
    ]),
    {
      channel: "linq",
      deliveryTarget: "linq_chat_real",
      identityId: "h1_111111111111111111111111",
      participantId: null,
      threadId: "h1_333333333333333333333333",
    },
  );
});

test("unambiguous current route returns null for multiple conversations or none", () => {
  assert.equal(resolveUnambiguousCurrentDeliveryRoute([]), null);
  assert.equal(
    resolveUnambiguousCurrentDeliveryRoute([
      { channel: "linq", deliveryTarget: "linq_chat_real" },
      { channel: "linq", deliveryTarget: "linq_chat_other" },
    ]),
    null,
  );
});
