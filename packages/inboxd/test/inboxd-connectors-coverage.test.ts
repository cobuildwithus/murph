import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import { normalizeHostedTelegramMessage } from "../src/connectors/telegram/normalize.ts";

import type {
  ChatPollDriver,
  InboundAttachment,
  InboundCapture,
  ParsedEmailMessage,
  PersistedCapture,
  TelegramPollDriver,
} from "../src/index.ts";
import {
  compareInboundCaptures,
  createAgentmailApiPollDriver,
  createEmailPollConnector,
  createInboundCaptureFromChatMessage,
  createLinqWebhookConnector,
  createNormalizedChatPollConnector,
  createTelegramPollConnector,
  normalizeLinqWebhookEvent,
  normalizeParsedEmailMessage,
  normalizeTelegramUpdate,
  readRawEmailHeaderValue,
  splitEmailAddressList,
} from "../src/index.ts";
import { buildV2026LinqWebhookEvent } from "./linq-test-helpers.ts";

function buildCapture(input: {
  externalId: string;
  occurredAt: string;
  text?: string | null;
}): InboundCapture {
  return {
    source: "chat",
    externalId: input.externalId,
    accountId: "acct-1",
    thread: {
      id: "thread-1",
      title: "General",
      isDirect: false,
    },
    actor: {
      id: "actor-1",
      displayName: "Alice",
      isSelf: false,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.occurredAt,
    text: input.text ?? input.externalId,
    attachments: [],
    raw: {
      externalId: input.externalId,
    },
  };
}

function createPersistedCapture(capture: InboundCapture): PersistedCapture {
  return {
    captureId: `cap-${capture.externalId}`,
    eventId: `evt-${capture.externalId}`,
    auditId: `aud-${capture.externalId}`,
    envelopePath: `raw/inbox/${capture.source}/${capture.externalId}.json`,
    createdAt: capture.occurredAt,
    deduped: false,
  };
}

test("createInboundCaptureFromChatMessage preserves nullable chat fields and compareInboundCaptures breaks ties by externalId", () => {
  const attachments: InboundAttachment[] = [
    {
      byteSize: 4,
      data: new Uint8Array([1, 2, 3, 4]),
      externalId: "att-1",
      fileName: "photo.jpg",
      kind: "image",
      mime: "image/jpeg",
    },
  ];

  const capture = createInboundCaptureFromChatMessage({
    source: "telegram",
    message: {
      externalId: "msg-2",
      thread: {
        id: "thread-1",
      },
      actor: {
        isSelf: true,
      },
      occurredAt: "2026-04-08T10:00:00.000Z",
      text: null,
      attachments,
      raw: {
        schema: "test",
      },
    },
  });

  assert.deepEqual(capture, {
    source: "telegram",
    externalId: "msg-2",
    accountId: null,
    thread: {
      id: "thread-1",
      title: null,
      isDirect: undefined,
    },
    actor: {
      id: null,
      displayName: null,
      isSelf: true,
    },
    occurredAt: "2026-04-08T10:00:00.000Z",
    receivedAt: null,
    text: null,
    attachments,
    raw: {
      schema: "test",
    },
  });

  assert.ok(
    compareInboundCaptures(
      buildCapture({
        externalId: "msg-2",
        occurredAt: "2026-04-08T10:00:00.000Z",
      }),
      buildCapture({
        externalId: "msg-3",
        occurredAt: "2026-04-08T10:00:00.000Z",
      }),
    ) < 0,
  );
  assert.ok(
    compareInboundCaptures(
      buildCapture({
        externalId: "msg-9",
        occurredAt: "2026-04-08T09:59:59.000Z",
      }),
      buildCapture({
        externalId: "msg-1",
        occurredAt: "2026-04-08T10:00:00.000Z",
      }),
    ) < 0,
  );
});

test("createNormalizedChatPollConnector backfill sorts captures, skips duplicate checkpoints, and reuses loaded context", async () => {
  type TestChatMessage = {
    id: string;
    occurredAt: string;
  };
  type TestChatDriver = ChatPollDriver<TestChatMessage>;

  const loadContext = vi.fn(async () => ({ label: "loaded" }));
  const getMessages = vi
    .fn<TestChatDriver["getMessages"]>()
    .mockImplementationOnce(async ({ cursor, includeOwnMessages, limit }) => {
      assert.deepEqual(cursor, { messageId: "msg-2" });
      assert.equal(includeOwnMessages, false);
      assert.equal(limit, 3);
      return [
        {
          id: "msg-3",
          occurredAt: "2026-04-08T10:00:03.000Z",
        },
        {
          id: "msg-2",
          occurredAt: "2026-04-08T10:00:02.000Z",
        },
      ];
    })
    .mockImplementationOnce(async ({ cursor }) => {
      assert.deepEqual(cursor, { messageId: "msg-3" });
      return [];
    });

  const normalize = vi.fn(async ({ message, context }: {
    message: TestChatMessage;
    context: { label: string } | null;
  }) =>
    buildCapture({
      externalId: message.id,
      occurredAt: message.occurredAt,
      text: `${context?.label}:${message.id}`,
    }),
  );

  const connector = createNormalizedChatPollConnector({
    driver: {
      getMessages,
      async startWatching() {
        return undefined;
      },
    },
    id: "chat-test",
    source: "chat",
    accountId: "acct-1",
    includeOwnMessages: false,
    backfillLimit: 3,
    capabilities: {
      attachments: false,
    },
    loadContext,
    checkpoint: ({ message }) => ({
      messageId: message.id,
    }),
    normalize,
  });

  const emitted: Array<{ externalId: string; checkpoint: Record<string, unknown> | null | undefined }> = [];
  const nextCursor = await connector.backfill({ messageId: "msg-2" }, async (capture, checkpoint) => {
    emitted.push({
      externalId: capture.externalId,
      checkpoint,
    });
    return createPersistedCapture(capture);
  });

  assert.equal(connector.capabilities.attachments, false);
  assert.equal(connector.capabilities.ownMessages, false);
  assert.equal(loadContext.mock.calls.length, 1);
  assert.equal(normalize.mock.calls.length, 2);
  for (const call of normalize.mock.calls) {
    assert.deepEqual(call[0].context, { label: "loaded" });
  }
  assert.deepEqual(emitted, [
    {
      externalId: "msg-3",
      checkpoint: { messageId: "msg-3" },
    },
  ]);
  assert.deepEqual(nextCursor, { messageId: "msg-3" });
});

test("createNormalizedChatPollConnector watch stops stop-only watchers and ignores messages after abort", async () => {
  type TestChatMessage = {
    id: string;
    occurredAt: string;
  };
  type TestChatDriver = ChatPollDriver<TestChatMessage>;

  let onMessage: ((message: TestChatMessage) => Promise<void>) | null = null;
  const stop = vi.fn(async () => undefined);

  const driver: TestChatDriver = {
    async getMessages() {
      return [];
    },
    async startWatching(input: Parameters<TestChatDriver["startWatching"]>[0]) {
      onMessage = async (message) => {
        await input.onMessage(message);
      };
      return {
        stop,
      };
    },
  };

  const connector = createNormalizedChatPollConnector<TestChatMessage, TestChatDriver>({
    driver,
    id: "chat-watch",
    source: "chat",
    checkpoint: ({ message }) => ({
      messageId: message.id,
    }),
    normalize: async ({ message }) =>
      buildCapture({
        externalId: message.id,
        occurredAt: message.occurredAt,
      }),
  });

  const emitted: string[] = [];
  const controller = new AbortController();
  const watchPromise = connector.watch(null, async (capture) => {
    emitted.push(capture.externalId);
    return createPersistedCapture(capture);
  }, controller.signal);

  await vi.waitFor(() => {
    assert.ok(onMessage);
  });

  const emitMessage = async (message: TestChatMessage) => {
    if (!onMessage) {
      throw new Error("expected chat watcher callback");
    }

    await onMessage(message);
  };
  await emitMessage({
    id: "msg-1",
    occurredAt: "2026-04-08T10:00:01.000Z",
  });
  controller.abort();
  await watchPromise;
  await emitMessage({
    id: "msg-2",
    occurredAt: "2026-04-08T10:00:02.000Z",
  });

  assert.deepEqual(emitted, ["msg-1"]);
  assert.equal(stop.mock.calls.length, 1);
});

test("splitEmailAddressList preserves quoted commas and readRawEmailHeaderValue rejects repeated headers", () => {
  assert.deepEqual(
    splitEmailAddressList(
      '"Doe, Jane" <jane@example.test>, =?UTF-8?Q?Jos=C3=A9?= <jose@example.test>',
    ),
    [
      '"Doe, Jane" <jane@example.test>',
      "José <jose@example.test>",
    ],
  );

  const repeatedHeaderValue = readRawEmailHeaderValue([
    "Subject: First value",
    "Subject: Second value",
    "",
    "body",
  ].join("\r\n"), "subject");
  assert.deepEqual(repeatedHeaderValue, {
    repeated: true,
    value: null,
  });

  const singleHeaderValue = readRawEmailHeaderValue([
    "Subject: =?UTF-8?Q?Ol=C3=A1?=",
    "",
    "body",
  ].join("\r\n"), "subject");
  assert.deepEqual(singleHeaderValue, {
    repeated: false,
    value: "Olá",
  });
});

test("normalizeParsedEmailMessage builds fallback thread targets, dedupes reply-all recipients, and falls back to raw-hash external ids", async () => {
  const message: ParsedEmailMessage = {
    attachments: [
      {
        contentDisposition: "inline",
        contentId: "cid-photo",
        contentTransferEncoding: "base64",
        contentType: "image/png",
        data: new Uint8Array([1, 2, 3]),
        fileName: "photo.png",
      },
    ],
    bcc: [],
    cc: [
      "assistant@example.test",
      "Team Example <team@example.test>",
      "reply@example.test",
    ],
    from: "Assistant Alias <assistant+alias@example.test>",
    headers: {
      "x-trace-id": "trace-1",
    },
    html: null,
    inReplyTo: "<prior@example.test>",
    messageId: null,
    occurredAt: "2026-04-08T11:30:00.000Z",
    rawHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    rawSize: 512,
    receivedAt: "2026-04-08T11:31:00.000Z",
    references: ["<root@example.test>", ""],
    replyTo: [
      "Reply Desk <reply@example.test>",
      "Team Example <team@example.test>",
      "assistant@example.test",
      "Reply Desk <reply@example.test>",
    ],
    subject: "  Inbox coverage  ",
    text: "Inline photo attached",
    to: [
      "Customer Example <customer@example.test>",
      "assistant+alias@example.test",
    ],
  };

  const capture = await normalizeParsedEmailMessage({
    accountAddress: "assistant@example.test",
    accountId: "acct-email",
    message,
    selfAddresses: [
      "assistant+alias@example.test",
      "assistant@example.test",
      "ASSISTANT@example.test",
    ],
    source: "email-import",
    threadTarget: "not-a-valid-thread-target",
  });
  const threadTarget = parseHostedEmailThreadTarget(capture.thread.id);

  assert.equal(capture.source, "email-import");
  assert.equal(capture.accountId, "acct-email");
  assert.equal(capture.externalId, "email:0123456789abcdef01234567");
  assert.equal(capture.thread.title, "Inbox coverage");
  assert.equal(capture.thread.isDirect, false);
  assert.equal(capture.actor.id, "assistant+alias@example.test");
  assert.equal(capture.actor.displayName, "Assistant Alias");
  assert.equal(capture.actor.isSelf, true);
  assert.equal(capture.receivedAt, "2026-04-08T11:31:00.000Z");
  assert.equal(capture.attachments[0]?.kind, "image");
  assert.equal(capture.attachments[0]?.externalId, "cid-photo");
  assert.equal(capture.attachments[0]?.byteSize, 3);
  assert.deepEqual(threadTarget?.to, ["reply@example.test"]);
  assert.deepEqual(threadTarget?.cc, [
    "team@example.test",
    "customer@example.test",
  ]);
  assert.deepEqual(threadTarget?.references, [
    "<root@example.test>",
    "<prior@example.test>",
  ]);
  assert.equal(threadTarget?.subject, "Inbox coverage");
  assert.equal((capture.raw.headers as Record<string, unknown>)["x-trace-id"], "trace-1");
});

test("createAgentmailApiPollDriver validates inputs, normalizes empty download URLs, and createEmailPollConnector rejects tiny poll intervals", async () => {
  assert.throws(
    () =>
      createAgentmailApiPollDriver({
        apiKey: " ",
        inboxId: "inbox-1",
        fetchImplementation: async () => {
          throw new Error("not used");
        },
      }),
    /non-empty API key/u,
  );
  assert.throws(
    () =>
      createAgentmailApiPollDriver({
        apiKey: "key",
        inboxId: " ",
        fetchImplementation: async () => {
          throw new Error("not used");
        },
      }),
    /non-empty inbox id/u,
  );
  assert.throws(
    () =>
      createAgentmailApiPollDriver({
        apiKey: "key",
        inboxId: "inbox-1",
        baseUrl: " ",
        fetchImplementation: async () => {
          throw new Error("not used");
        },
      }),
    /non-empty base URL/u,
  );
  const requests: Array<{ method: string; url: string; body?: string }> = [];
  const driver = createAgentmailApiPollDriver({
    apiKey: "am-key",
    inboxId: "inbox-1",
    baseUrl: "https://mail.example.test/v0/",
    fetchImplementation: async (url, init) => {
      requests.push({
        method: init.method,
        url,
        body: init.body,
      });

      if (url.includes("/messages?")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              count: 0,
              messages: null,
            };
          },
          async text() {
            return "";
          },
          async arrayBuffer() {
            return new ArrayBuffer(0);
          },
        };
      }

      if (url.endsWith("/attachments/att-empty")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              attachment_id: "att-empty",
              download_url: "   ",
            };
          },
          async text() {
            return "";
          },
          async arrayBuffer() {
            return new ArrayBuffer(0);
          },
        };
      }

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            thread_id: "thread-1",
          };
        },
        async text() {
          return "";
        },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    },
  });

  assert.deepEqual(await driver.listUnreadMessages({ limit: 0 }), []);
  assert.equal(
    await driver.downloadAttachment({
      attachmentId: "att-empty",
      messageId: "msg-1",
    }),
    null,
  );
  assert.deepEqual(
    await driver.getThread?.({
      threadId: "thread-1",
    }),
    {
      thread_id: "thread-1",
    },
  );
  assert.equal(requests[0]?.url.includes("limit=1"), true);
  assert.equal(requests.some((request) => request.url.endsWith("/threads/thread-1")), true);

  assert.throws(
    () =>
      createEmailPollConnector({
        driver: {
          inboxId: "inbox-1",
          async listUnreadMessages() {
            return [];
          },
          async markProcessed() {},
          async downloadAttachment() {
            return null;
          },
        },
        pollIntervalMs: 249,
      }),
    /at least 250ms/u,
  );
});

test("createEmailPollConnector watch falls back to the driver inbox account, reuses unread summaries, and stops after aborting mid-batch", async () => {
  const processedMessageIds: string[] = [];
  const emitted: string[] = [];
  const controller = new AbortController();
  let unreadCalls = 0;

  const connector = createEmailPollConnector({
    accountId: null,
    backfillLimit: 2,
    driver: {
      inboxId: "inbox-coverage",
      async listUnreadMessages({ limit } = {}) {
        unreadCalls += 1;
        assert.equal(limit, 2);

        return [
          {
            inbox_id: "inbox-coverage",
            thread_id: "thread-1",
            message_id: "msg-watch-1",
            timestamp: "2026-04-08T12:00:00.000Z",
            from: "Alice Example <alice@example.test>",
            to: ["murph@example.test"],
            extracted_text: "summary body",
          },
          {
            inbox_id: "inbox-coverage",
            thread_id: "thread-1",
            message_id: "msg-watch-2",
            timestamp: "2026-04-08T12:01:00.000Z",
            from: "Alice Example <alice@example.test>",
            to: ["murph@example.test"],
            extracted_text: "should stay unread",
          },
        ];
      },
      async markProcessed({ messageId }) {
        processedMessageIds.push(messageId);
      },
      async downloadAttachment() {
        return null;
      },
    },
    pollIntervalMs: 250,
  });

  assert.equal(connector.id, "email:inbox-coverage");
  assert.equal(connector.accountId, "inbox-coverage");

  await connector.watch(
    null,
    async (capture) => {
      emitted.push(capture.externalId);
      assert.equal(capture.accountId, "inbox-coverage");
      assert.equal(capture.text, "summary body");
      controller.abort();

      return {
        captureId: "cap-email-watch-1",
        eventId: "evt-email-watch-1",
        envelopePath: "raw/inbox/email/msg-watch-1.json",
        createdAt: capture.occurredAt,
        deduped: false,
      };
    },
    controller.signal,
  );

  assert.equal(unreadCalls, 1);
  assert.deepEqual(emitted, ["email:msg-watch-1"]);
  assert.deepEqual(processedMessageIds, ["msg-watch-1"]);
});

test("createTelegramPollConnector fails closed when an active webhook exists but deleteWebhook is unavailable", async () => {
  const connector = createTelegramPollConnector({
    driver: {
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getMessages() {
        return [];
      },
      async startWatching() {
        return undefined;
      },
      async getFile() {
        throw new Error("not used");
      },
      async downloadFile() {
        throw new Error("not used");
      },
      async getWebhookInfo() {
        return {
          url: "https://example.invalid/webhook",
        };
      },
    },
    transportMode: "take-over-webhook",
    downloadAttachments: false,
  });

  await assert.rejects(
    () => connector.backfill(null, async (capture) => createPersistedCapture(capture)),
    /requires deleteWebhook support/u,
  );
});

test("createTelegramPollConnector deletes active webhooks once and skips file downloads when attachment hydration is disabled", async () => {
  let deleteWebhookCalls = 0;
  let downloadCalls = 0;
  const connector = createTelegramPollConnector({
    driver: {
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getMessages() {
        return [
          {
            update_id: 201,
            message: {
              message_id: 21,
              date: 1_773_400_000,
              text: "Photo without download",
              chat: {
                id: 42,
                type: "private",
                first_name: "Alice",
              },
              from: {
                id: 111,
                first_name: "Alice",
              },
              photo: [
                {
                  file_id: "photo-1",
                  file_unique_id: "photo-unique-1",
                  file_size: 64,
                  width: 64,
                  height: 64,
                },
              ],
            },
          },
        ];
      },
      async startWatching() {
        return undefined;
      },
      async deleteWebhook() {
        deleteWebhookCalls += 1;
      },
      async getWebhookInfo() {
        return {
          url: "https://example.invalid/webhook",
        };
      },
      async getFile() {
        downloadCalls += 1;
        throw new Error("not used");
      },
      async downloadFile() {
        downloadCalls += 1;
        throw new Error("not used");
      },
    },
    transportMode: "take-over-webhook",
    downloadAttachments: false,
  });
  const emitted: InboundCapture[] = [];

  await connector.backfill(null, async (capture) => {
    emitted.push(capture);
    return {
      captureId: "cap-telegram-1",
      eventId: "evt-telegram-1",
      envelopePath: "raw/inbox/telegram/update-201.json",
      createdAt: capture.occurredAt,
      deduped: false,
    };
  });
  await connector.backfill(null, async (capture) => {
    emitted.push(capture);
    return {
      captureId: "cap-telegram-2",
      eventId: "evt-telegram-2",
      envelopePath: "raw/inbox/telegram/update-201.json",
      createdAt: capture.occurredAt,
      deduped: false,
    };
  });

  assert.equal(deleteWebhookCalls, 1);
  assert.equal(downloadCalls, 0);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0]?.attachments[0]?.data ?? null, null);
});

test("createTelegramPollConnector treats blank webhook URLs as inactive, preserves null accounts, and keeps attachment metadata when file paths are missing", async () => {
  let deleteWebhookCalls = 0;
  let getMessagesCalls = 0;
  let getFileCalls = 0;
  let downloadFileCalls = 0;
  const connector = createTelegramPollConnector({
    accountId: null,
    driver: {
      async getMe() {
        return {
          id: 999,
          username: "murph_bot",
        };
      },
      async getMessages() {
        getMessagesCalls += 1;

        return getMessagesCalls === 1
          ? [
              {
                update_id: 211,
                message: {
                  message_id: 22,
                  date: 1_773_400_010,
                  text: "Document without file path",
                  chat: {
                    id: 42,
                    type: "private",
                    first_name: "Alice",
                  },
                  from: {
                    id: 111,
                    first_name: "Alice",
                  },
                  document: {
                    file_id: "doc-1",
                    file_unique_id: "doc-unique-1",
                    file_name: "notes.txt",
                  },
                },
              },
            ]
          : [];
      },
      async startWatching() {
        return undefined;
      },
      async deleteWebhook() {
        deleteWebhookCalls += 1;
      },
      async getWebhookInfo() {
        return {
          url: "   ",
        };
      },
      async getFile(fileId) {
        getFileCalls += 1;
        return {
          file_id: fileId,
        };
      },
      async downloadFile() {
        downloadFileCalls += 1;
        return new Uint8Array([1, 2, 3]);
      },
    },
    resetWebhookOnStart: false,
  });
  const emitted: InboundCapture[] = [];

  const cursor = await connector.backfill(null, async (capture) => {
    emitted.push(capture);
    return {
      captureId: "cap-telegram-blank-webhook",
      eventId: "evt-telegram-blank-webhook",
      envelopePath: "raw/inbox/telegram/update-211.json",
      createdAt: capture.occurredAt,
      deduped: false,
    };
  });

  assert.equal(connector.id, "telegram:default");
  assert.equal(connector.accountId, null);
  assert.equal(deleteWebhookCalls, 0);
  assert.equal(getFileCalls, 1);
  assert.equal(downloadFileCalls, 0);
  assert.deepEqual(cursor, { updateId: 211 });
  assert.equal(emitted[0]?.attachments[0]?.kind, "document");
  assert.equal(emitted[0]?.attachments[0]?.fileName, "notes.txt");
  assert.equal(emitted[0]?.attachments[0]?.data, undefined);
});

test("normalizeTelegramUpdate rejects unsupported payloads and normalizeHostedTelegramMessage infers multiple hosted attachment kinds", async () => {
  await assert.rejects(
    () =>
      normalizeTelegramUpdate({
        update: {
          update_id: 301,
        },
      }),
    /supported message payload/u,
  );

  const hosted = await normalizeHostedTelegramMessage({
    externalId: "evt-hosted-telegram-attachments",
    message: {
      messageId: "31",
      threadId: "-100555:topic:1",
      attachments: [
        {
          fileId: "doc-1",
          fileName: "lab.pdf",
          fileUniqueId: "doc-unique-1",
          kind: "document",
          mimeType: "application/pdf",
        },
        {
          fileId: "audio-1",
          fileUniqueId: "audio-unique-1",
          kind: "audio",
        },
        {
          fileId: "voice-1",
          fileUniqueId: "voice-unique-1",
          kind: "voice",
        },
        {
          fileId: "video-1",
          fileUniqueId: "video-unique-1",
          kind: "video",
        },
        {
          fileId: "video-note-1",
          fileUniqueId: "video-note-unique-1",
          kind: "video_note",
        },
        {
          fileId: "animation-1",
          fileUniqueId: "animation-unique-1",
          kind: "animation",
        },
        {
          fileId: "sticker-1",
          fileUniqueId: "sticker-unique-1",
          kind: "sticker",
        },
      ],
      text: "attachments",
    },
    occurredAt: "2026-04-08T12:30:00.000Z",
    downloadDriver: {
      async getFile(fileId) {
        return {
          file_id: fileId,
          file_path: `${fileId}.bin`,
        };
      },
      async downloadFile(filePath) {
        return new TextEncoder().encode(filePath);
      },
    },
  });

  assert.deepEqual(
    hosted.attachments.map((attachment) => attachment.kind),
    ["document", "audio", "audio", "video", "video", "video", "image"],
  );
  assert.deepEqual(
    hosted.attachments.map((attachment) => attachment.fileName),
    [
      "lab.pdf",
      "audio-audio-unique-1.bin",
      "voice-voice-unique-1.ogg",
      "video-video-unique-1.mp4",
      "video-note-video-note-unique-1.mp4",
      "animation-animation-unique-1.mp4",
      "sticker-sticker-unique-1.webp",
    ],
  );
  assert.equal(
    hosted.attachments.every((attachment) => attachment.data instanceof Uint8Array),
    true,
  );
});

test("normalizeTelegramUpdate collects non-photo attachment specs without downloads", async () => {
  const capture = await normalizeTelegramUpdate({
    update: {
      update_id: 302,
      message: {
        message_id: 32,
        date: 1_773_400_020,
        text: "mixed attachments",
        chat: {
          id: 55,
          type: "private",
          first_name: "Taylor",
        },
        from: {
          id: 222,
          first_name: "Taylor",
        },
        document: {
          file_id: "doc-2",
          file_unique_id: "doc-unique-2",
          mime_type: "application/pdf",
          file_name: "report.pdf",
        },
        audio: {
          file_id: "audio-2",
          file_unique_id: "audio-unique-2",
        },
        voice: {
          file_id: "voice-2",
          file_unique_id: "voice-unique-2",
        },
        video: {
          file_id: "video-2",
          file_unique_id: "video-unique-2",
        },
        animation: {
          file_id: "animation-2",
          file_unique_id: "animation-unique-2",
        },
        sticker: {
          file_id: "sticker-2",
          file_unique_id: "sticker-unique-2",
        },
      },
    },
  });

  assert.deepEqual(
    capture.attachments.map((attachment) => ({
      fileName: attachment.fileName,
      kind: attachment.kind,
      mime: attachment.mime ?? null,
    })),
    [
      { fileName: "report.pdf", kind: "document", mime: "application/pdf" },
      { fileName: "audio-audio-unique-2.bin", kind: "audio", mime: "audio/mpeg" },
      { fileName: "voice-voice-unique-2.ogg", kind: "audio", mime: "audio/ogg" },
      { fileName: "video-video-unique-2.mp4", kind: "video", mime: "video/mp4" },
      { fileName: "animation-animation-unique-2.mp4", kind: "video", mime: "video/mp4" },
      { fileName: "sticker-sticker-unique-2.webp", kind: "image", mime: null },
    ],
  );
  assert.equal(
    capture.attachments.every((attachment) => attachment.data === undefined),
    true,
  );
});

test("createLinqWebhookConnector normalizes constructor inputs and keeps backfill pure", async () => {
  const connector = createLinqWebhookConnector({
    source: " linq-alt ",
    accountId: " acct-1 ",
    host: "127.0.0.1",
    path: "hooks/linq",
    port: 8789,
    webhookSecret: "secret-123",
    downloadAttachments: false,
  });

  assert.equal(connector.id, "linq-alt:acct-1:8789");
  assert.equal(connector.source, "linq-alt");
  assert.equal(connector.accountId, "acct-1");
  assert.deepEqual(connector.capabilities, {
    backfill: false,
    watch: true,
    webhooks: true,
    attachments: true,
    ownMessages: true,
  });
  assert.deepEqual(
    await connector.backfill(
      { seen: "cursor-1" },
      async (capture) => createPersistedCapture(capture),
    ),
    { seen: "cursor-1" },
  );
});

test("normalizeLinqWebhookEvent keeps voice attachments when downloads fail", async () => {
  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: "hbidx:phone:v1:test",
    downloadDriver: {
      async downloadUrl() {
        throw new Error("download failed");
      },
    },
    event: buildV2026LinqWebhookEvent({
      data: {
        chat: {
          id: "chat-voice",
          owner_handle: {
            handle: "+15557654321",
            id: "handle-owner-voice",
            is_me: true,
            service: "SMS",
          },
        },
        id: "msg-voice",
        parts: [
          {
            id: "att-voice",
            mime_type: "audio/amr",
            size_bytes: 512,
            type: "media",
            url: "https://cdn.example.test/voice.amr",
          },
        ],
        sender_handle: {
          handle: "+15551234567",
          id: "handle-sender-voice",
          service: "SMS",
        },
      },
      eventId: "evt-voice",
    }) as never,
  });

  assert.equal(capture.accountId, "+15557654321");
  assert.deepEqual(capture.attachments, [
    {
      byteSize: 512,
      data: null,
      externalId: "att-voice",
      fileName: "voice.amr",
      kind: "audio",
      mime: "audio/amr",
    },
  ]);
});
