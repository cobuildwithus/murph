import assert from "node:assert/strict";

import { test } from "vitest";

import {
  readHostedAssistantInputCurrentDeliveryRoute,
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
