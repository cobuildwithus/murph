import assert from "node:assert/strict";

import { test } from "vitest";

import {
  minimizeTelegramUpdate,
  parseTelegramWebhookUpdate,
  summarizeTelegramUpdate,
} from "../src/index.ts";

test("parseTelegramWebhookUpdate validates supported message fields", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: {
      chat: {
        id: 123,
        is_direct_messages: true,
        type: "private",
      },
      date: 1_774_522_600,
      direct_messages_topic: {
        title: "Business DM",
        topic_id: 7,
      },
      from: {
        first_name: "Alice",
        id: 456,
      },
      message_id: 1,
      reply_to_message: {
        chat: {
          id: 123,
          type: "private",
        },
        direct_messages_topic: {
          title: "Earlier",
          topic_id: 6,
        },
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: 2,
        text: "Earlier message",
      },
      text: "hello",
    },
    update_id: 321,
  }));

  assert.equal(update.update_id, 321);
  assert.equal(update.message?.direct_messages_topic?.topic_id, 7);
  assert.equal(update.message?.reply_to_message?.direct_messages_topic?.topic_id, 6);
});

test("parseTelegramWebhookUpdate rejects invalid direct message topics", () => {
  assert.throws(
    () =>
      parseTelegramWebhookUpdate(JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          direct_messages_topic: {
            topic_id: "nope",
          },
          message_id: 1,
        },
        update_id: 321,
      })),
    /message\.direct_messages_topic\.topic_id must be an integer/u,
  );
});

test("summarizeTelegramUpdate infers hosted bot identity only when asked", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: {
      chat: {
        id: 123,
        type: "private",
      },
      date: 1_774_522_600,
      from: {
        first_name: "Murph Bot",
        id: 999,
        is_bot: true,
      },
      message_id: 1,
      text: "hello",
    },
    update_id: 321,
  }));

  const localSummary = summarizeTelegramUpdate({ update });
  const hostedSummary = summarizeTelegramUpdate({
    inferBotUserIdFromMessage: true,
    update,
  });

  assert.equal(localSummary?.botUserId, null);
  assert.equal(localSummary?.actor.isSelf, false);
  assert.equal(hostedSummary?.botUserId, "999");
  assert.equal(hostedSummary?.actor.isSelf, true);
});

test("minimizeTelegramUpdate preserves allowlisted nested reply metadata", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    business_message: {
      business_connection_id: "biz_123",
      caption: "album caption",
      chat: {
        id: "123",
        is_direct_messages: true,
        title: "Business",
        type: "private",
      },
      date: 1_774_522_600,
      direct_messages_topic: {
        title: "Business DM",
        topic_id: 7,
      },
      from: {
        first_name: "Alice",
        id: 456,
      },
      media_group_id: "album_123",
      message_id: 5,
      reply_to_message: {
        business_connection_id: "biz_123",
        chat: {
          id: "123",
          is_direct_messages: true,
          type: "private",
        },
        direct_messages_topic: {
          title: "Earlier DM",
          topic_id: 6,
        },
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: 4,
        text: "Earlier message",
      },
    },
    update_id: 321,
  }));

  const minimized = minimizeTelegramUpdate(update);
  const businessMessage =
    minimized.business_message && typeof minimized.business_message === "object"
      ? (minimized.business_message as Record<string, unknown>)
      : null;
  const replyToMessage =
    businessMessage?.reply_to_message && typeof businessMessage.reply_to_message === "object"
      ? (businessMessage.reply_to_message as Record<string, unknown>)
      : null;

  assert.equal(minimized.update_id, 321);
  assert.equal(minimized.message, null);
  assert.equal(businessMessage?.business_connection_id, "biz_123");
  assert.equal(businessMessage?.caption, "album caption");
  assert.equal(businessMessage?.media_group_id, "album_123");
  assert.deepEqual(businessMessage?.direct_messages_topic, {
    title: "Business DM",
    topic_id: 7,
  });
  assert.deepEqual(replyToMessage?.direct_messages_topic, {
    title: "Earlier DM",
    topic_id: 6,
  });
  assert.equal(replyToMessage?.business_connection_id, "biz_123");
  assert.equal(replyToMessage?.text, "Earlier message");
});
