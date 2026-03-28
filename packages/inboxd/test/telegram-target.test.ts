import assert from "node:assert/strict";
import { test } from "vitest";

import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
} from "../src/index.ts";

test("Telegram thread targets round-trip business and direct-message topic routing", () => {
  const target = parseTelegramThreadTarget("-1001234567890:business:biz-42:dm-topic:9");

  assert.deepEqual(target, {
    businessConnectionId: "biz-42",
    chatId: "-1001234567890",
    directMessagesTopicId: 9,
    messageThreadId: null,
  });
  assert.equal(
    serializeTelegramThreadTarget(target!),
    "-1001234567890:business:biz-42:dm-topic:9",
  );
});

test("Telegram thread targets reject malformed routing fragments", () => {
  assert.equal(parseTelegramThreadTarget(""), null);
  assert.equal(parseTelegramThreadTarget(":topic:42"), null);
  assert.equal(parseTelegramThreadTarget("123:topic:0"), null);
  assert.equal(parseTelegramThreadTarget("123:dm-topic:abc"), null);
  assert.equal(parseTelegramThreadTarget("123:topic:42:dm-topic:7"), null);
  assert.equal(parseTelegramThreadTarget("123:business::topic:42"), null);
  assert.equal(parseTelegramThreadTarget("123:business:%E0%A4%A:topic:42"), null);
});
