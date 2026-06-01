import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteLinqMessage: vi.fn(async () => {}),
  deleteTelegramMessages: vi.fn(async () => {}),
}));

vi.mock("@murphai/operator-config/linq-runtime", () => ({
  deleteLinqMessage: mocks.deleteLinqMessage,
}));

vi.mock("@murphai/operator-config/telegram-runtime", () => ({
  deleteTelegramMessages: mocks.deleteTelegramMessages,
}));

import {
  deleteHostedLinqMessages,
  deleteHostedTelegramMessages,
} from "../src/hosted-runtime/message-cleanup.ts";

afterEach(() => {
  vi.clearAllMocks();
});

test("deleteHostedLinqMessages deletes unique non-empty ids and forwards dependencies", async () => {
  const env: NodeJS.ProcessEnv = {
    LINQ_API_TOKEN: "linq-token",
  };
  const fetchImplementation = vi.fn();
  const controller = new AbortController();

  await deleteHostedLinqMessages({
    env,
    fetchImplementation,
    messageIds: ["msg_1", "", "msg_1", "  ", "msg_2"],
    signal: controller.signal,
  });

  expect(mocks.deleteLinqMessage).toHaveBeenCalledTimes(2);
  expect(mocks.deleteLinqMessage).toHaveBeenNthCalledWith(1, {
    messageId: "msg_1",
  }, {
    env,
    fetchImplementation,
    signal: controller.signal,
  });
  expect(mocks.deleteLinqMessage).toHaveBeenNthCalledWith(2, {
    messageId: "msg_2",
  }, {
    env,
    fetchImplementation,
    signal: controller.signal,
  });
});

test("deleteHostedTelegramMessages skips empty batches after normalization", async () => {
  await deleteHostedTelegramMessages({
    fetchImplementation: vi.fn(),
    messageIds: ["", "   "],
    target: "chat_123",
  });

  expect(mocks.deleteTelegramMessages).not.toHaveBeenCalled();
});

test("deleteHostedTelegramMessages deletes unique non-empty ids and forwards dependencies", async () => {
  const env: NodeJS.ProcessEnv = {
    TELEGRAM_BOT_TOKEN: "telegram-token",
  };
  const fetchImplementation = vi.fn();
  const controller = new AbortController();

  await deleteHostedTelegramMessages({
    env,
    fetchImplementation,
    messageIds: ["msg_1", " ", "msg_2", "msg_1"],
    signal: controller.signal,
    target: "chat_123",
  });

  expect(mocks.deleteTelegramMessages).toHaveBeenCalledTimes(1);
  expect(mocks.deleteTelegramMessages).toHaveBeenCalledWith({
    messageIds: ["msg_1", "msg_2"],
    target: "chat_123",
  }, {
    env,
    fetchImplementation,
    signal: controller.signal,
  });
});
