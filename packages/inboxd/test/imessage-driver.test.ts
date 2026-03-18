import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const imessageMocks = vi.hoisted(() => ({
  closeCalls: 0,
  getMessagesResult: {
    messages: [] as Record<string, unknown>[],
    total: 0,
    unreadCount: 0,
  },
  lastGetMessagesFilter: undefined as Record<string, unknown> | undefined,
  lastWatcherEvents: undefined as
    | {
        onError?: (error: Error) => void;
        onMessage?: (message: Record<string, unknown>) => void | Promise<void>;
      }
    | undefined,
  listChatsResult: [] as Record<string, unknown>[],
  stopWatchingCalls: 0,
}));

vi.mock("@photon-ai/imessage-kit", () => ({
  IMessageSDK: class {
    async getMessages(filter?: Record<string, unknown>) {
      imessageMocks.lastGetMessagesFilter = filter;
      return imessageMocks.getMessagesResult;
    }

    async listChats() {
      return imessageMocks.listChatsResult;
    }

    async startWatching(events?: {
      onError?: (error: Error) => void;
      onMessage?: (message: Record<string, unknown>) => void | Promise<void>;
    }) {
      imessageMocks.lastWatcherEvents = events;
    }

    stopWatching() {
      imessageMocks.stopWatchingCalls += 1;
    }

    async close() {
      imessageMocks.closeCalls += 1;
    }
  },
}));

import { loadImessageKitDriver } from "../src/connectors/imessage/connector.js";

afterEach(() => {
  imessageMocks.closeCalls = 0;
  imessageMocks.getMessagesResult = {
    messages: [],
    total: 0,
    unreadCount: 0,
  };
  imessageMocks.lastGetMessagesFilter = undefined;
  imessageMocks.lastWatcherEvents = undefined;
  imessageMocks.listChatsResult = [];
  imessageMocks.stopWatchingCalls = 0;
});

test("loadImessageKitDriver adapts IMessageSDK query and chat results to the inboxd driver shape", async () => {
  const sentAt = new Date("2026-03-18T12:00:00.000Z");
  imessageMocks.getMessagesResult = {
    messages: [
      {
        id: "msg-1",
        guid: "im-msg-1",
        text: "hello",
        date: sentAt,
        chatId: "chat-1",
        sender: "+15551234567",
        senderName: "Alice",
        isFromMe: false,
        attachments: [
          {
            id: "attachment-1",
            filename: "note.jpg",
            mimeType: "image/jpeg",
            path: "/tmp/note.jpg",
            size: 12,
          },
        ],
      },
    ],
    total: 1,
    unreadCount: 1,
  };
  imessageMocks.listChatsResult = [
    {
      chatId: "chat-1",
      displayName: "Alice",
      isGroup: false,
    },
  ];

  const driver = await loadImessageKitDriver();
  const messages = await driver.getMessages({
    includeOwnMessages: false,
    limit: 5,
  });
  const chats = await driver.listChats?.();

  assert.deepEqual(imessageMocks.lastGetMessagesFilter, {
    excludeOwnMessages: true,
    limit: 5,
  });
  assert.equal(imessageMocks.closeCalls, 2);
  assert.deepEqual(messages, [
    {
      id: "msg-1",
      guid: "im-msg-1",
      text: "hello",
      date: sentAt,
      chatId: "chat-1",
      handleId: "+15551234567",
      sender: "+15551234567",
      displayName: "Alice",
      senderName: "Alice",
      isFromMe: false,
      attachments: [
        {
          id: "attachment-1",
          filename: "note.jpg",
          mimeType: "image/jpeg",
          path: "/tmp/note.jpg",
          size: 12,
        },
      ],
    },
  ]);
  assert.deepEqual(chats, [
    {
      id: "chat-1",
      displayName: "Alice",
      title: "Alice",
      isGroup: false,
      participantCount: 1,
    },
  ]);
});

test("loadImessageKitDriver watch filtering skips own messages and closes the SDK on abort", async () => {
  const driver = await loadImessageKitDriver();
  const received: Record<string, unknown>[] = [];
  const controller = new AbortController();
  const handle = await driver.startWatching({
    includeOwnMessages: false,
    signal: controller.signal,
    onMessage(message) {
      received.push(message as Record<string, unknown>);
    },
  });

  await imessageMocks.lastWatcherEvents?.onMessage?.({
    id: "msg-own",
    guid: "im-own",
    text: "mine",
    date: new Date("2026-03-18T12:01:00.000Z"),
    chatId: "chat-1",
    sender: "+15550000000",
    senderName: "Me",
    isFromMe: true,
    attachments: [],
  });
  await imessageMocks.lastWatcherEvents?.onMessage?.({
    id: "msg-other",
    guid: "im-other",
    text: "theirs",
    date: new Date("2026-03-18T12:02:00.000Z"),
    chatId: "chat-1",
    sender: "+15551234567",
    senderName: "Alice",
    isFromMe: false,
    attachments: [],
  });

  assert.equal(received.length, 1);
  assert.equal(received[0]?.guid, "im-other");

  controller.abort();
  await handle?.done;

  assert.equal(imessageMocks.stopWatchingCalls, 1);
  assert.equal(imessageMocks.closeCalls, 1);
});
