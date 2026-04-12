import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildTelegramThreadId,
  buildTelegramThreadTarget,
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
  type TelegramMessageLike,
} from "../src/telegram-webhook.ts";

test("Telegram thread targets round-trip business and DM topic metadata", () => {
  const target = parseTelegramThreadTarget("-1001234567890:business:biz-42:dm-topic:9");

  assert.deepEqual(target, {
    businessConnectionId: "biz-42",
    chatId: "-1001234567890",
    directMessagesTopicId: 9,
  });
  assert.equal(
    serializeTelegramThreadTarget(target!),
    "-1001234567890:business:biz-42:dm-topic:9",
  );
});

test("Telegram thread target parser rejects malformed values", () => {
  assert.equal(parseTelegramThreadTarget(""), null);
  assert.equal(parseTelegramThreadTarget(":topic:42"), null);
  assert.equal(parseTelegramThreadTarget("123:topic:0"), null);
  assert.equal(parseTelegramThreadTarget("123:dm-topic:abc"), null);
  assert.equal(parseTelegramThreadTarget("123:topic:42:dm-topic:7"), null);
  assert.equal(parseTelegramThreadTarget("123:business::topic:42"), null);
  assert.equal(parseTelegramThreadTarget("123:business:%E0%A4%A:topic:42"), null);
});

test("buildTelegramThreadTarget prefers direct-message topics over message thread ids", () => {
  const message: TelegramMessageLike = {
    chat: { id: 42, type: "private" },
    direct_messages_topic: { topic_id: 9, title: "Murph" },
    message_id: 7,
    message_thread_id: 5,
  };

  assert.deepEqual(buildTelegramThreadTarget(message), {
    businessConnectionId: null,
    chatId: "42",
    directMessagesTopicId: 9,
    messageThreadId: null,
  });
  assert.equal(buildTelegramThreadId(message), "42:dm-topic:9");
  assert.deepEqual(parseTelegramThreadTarget(buildTelegramThreadId(message)), {
    chatId: "42",
    directMessagesTopicId: 9,
  });
});

test("serializeTelegramThreadTarget normalizes manual targets before encoding", () => {
  assert.equal(
    serializeTelegramThreadTarget({
      businessConnectionId: "biz:abc",
      chatId: "chat-7",
      directMessagesTopicId: 4,
      messageThreadId: 3,
    }),
    "chat-7:business:biz%3Aabc:dm-topic:4",
  );
});
