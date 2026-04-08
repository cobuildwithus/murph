import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { test, vi } from "vitest";

import type { InboundCapture, PersistedCapture } from "@murphai/inboxd";
import {
  createInboxPipeline,
  openInboxRuntime,
  runPollConnector,
} from "@murphai/inboxd";
import { initializeVault } from "@murphai/core";

vi.mock("@photon-ai/imessage-kit", () => ({
  IMessageSDK: class IMessageSDK {},
}));

import { createImessageConnector } from "../src/connector.ts";

function createPersistedCapture(capture: InboundCapture): PersistedCapture {
  return {
    captureId: `cap-${capture.externalId}`,
    eventId: `evt-${capture.externalId}`,
    envelopePath: `raw/inbox/${capture.source}/${capture.externalId}.json`,
    createdAt: capture.occurredAt,
    deduped: false,
  };
}

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("createImessageConnector loads chats lazily and refreshes metadata when a watch message misses cache", async () => {
  const emitted: InboundCapture[] = [];
  let listChatsCalls = 0;
  type RefreshWatcher = (message: {
    guid: string;
    chatGuid: string;
    date: string;
    text: string;
  }) => Promise<void> | void;
  let watcher: RefreshWatcher | null = null;
  let closeCount = 0;
  const connector = createImessageConnector({
    driver: {
      async getMessages() {
        return {
          messages: [
            {
              guid: "im-backfill-1",
              chatGuid: "chat-known",
              date: "2026-03-13T08:00:00.000Z",
              text: "First capture",
            },
          ],
        };
      },
      async listChats() {
        listChatsCalls += 1;

        if (listChatsCalls === 1) {
          return [
            {
              guid: "chat-known",
              displayName: "Known Chat",
            },
          ];
        }

        return [
          {
            guid: "chat-known",
            displayName: "Known Chat",
          },
          {
            guid: "chat-refreshed",
            displayName: "Refreshed Chat",
          },
        ];
      },
      async startWatching(options) {
        watcher = options.onMessage as RefreshWatcher;
        return {
          close() {
            closeCount += 1;
          },
        };
      },
    },
    accountId: "self",
  });

  assert.equal(listChatsCalls, 0);

  await connector.backfill(null, async (capture: InboundCapture) => {
    emitted.push(capture);
    return createPersistedCapture(capture);
  });

  assert.equal(listChatsCalls, 1);
  assert.equal(emitted[0]?.thread.title, "Known Chat");

  const controller = new AbortController();
  const running = connector.watch(
    null,
    async (capture: InboundCapture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  const activeWatcher =
    watcher ??
    (async (_message: Parameters<RefreshWatcher>[0]) => {
      throw new TypeError("Expected iMessage watch callback to be registered.");
    });
  await activeWatcher({
    guid: "im-watch-1",
    chatGuid: "chat-refreshed",
    date: "2026-03-13T08:05:00.000Z",
    text: "Second capture",
  });
  controller.abort();
  await running;

  assert.equal(listChatsCalls, 2);
  assert.equal(emitted[1]?.thread.title, "Refreshed Chat");
  assert.equal(closeCount, 1);
});

test("createImessageConnector preserves an explicit null account scope while defaulting only omitted accounts", async () => {
  const captures: InboundCapture[] = [];
  const explicitNull = createImessageConnector({
    driver: {
      async getMessages() {
        return {
          messages: [
            {
              guid: "im-null-account",
              chatGuid: "chat-null-account",
              date: "2026-03-13T08:00:00.000Z",
            },
          ],
        };
      },
      async startWatching() {},
    },
    accountId: null,
  });
  const defaulted = createImessageConnector({
    driver: {
      async getMessages() {
        return {
          messages: [],
        };
      },
      async startWatching() {},
    },
  });

  await explicitNull.backfill(null, async (capture: InboundCapture) => {
    captures.push(capture);
    return createPersistedCapture(capture);
  });

  assert.equal(explicitNull.id, "imessage:default");
  assert.equal(explicitNull.accountId, null);
  assert.equal(captures[0]?.accountId, null);
  assert.equal(defaulted.id, "imessage:self");
  assert.equal(defaulted.accountId, "self");
});

test("createImessageConnector snapshots ephemeral temp-file attachments during backfill when they are small enough", async () => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-imessage-ephemeral-"));
  const attachmentPath = path.join(
    sourceRoot,
    "TemporaryItems",
    "com.apple.imagent",
    "photo.jpg",
  );
  await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
  await fs.writeFile(attachmentPath, "ephemeral-image", "utf8");

  const captures: InboundCapture[] = [];
  const connector = createImessageConnector({
    driver: {
      async getMessages() {
        return {
          messages: [
            {
              guid: "im-ephemeral-data",
              chatGuid: "chat-ephemeral-data",
              date: "2026-03-13T08:00:00.000Z",
              attachments: [
                {
                  id: "att-ephemeral-data",
                  path: attachmentPath,
                  filename: "photo.jpg",
                  mimeType: "image/jpeg",
                  size: 15,
                },
              ],
            },
          ],
        };
      },
      async startWatching() {},
    },
    accountId: "self",
  });

  await connector.backfill(null, async (capture: InboundCapture) => {
    captures.push(capture);
    return createPersistedCapture(capture);
  });

  const attachment = captures[0]?.attachments[0];
  assert.ok(attachment);
  assert.equal(Buffer.from(attachment.data ?? []).toString("utf8"), "ephemeral-image");
  assert.equal(attachment.originalPath, attachmentPath);
});

test("createImessageConnector downgrades missing ephemeral temp-file attachments instead of failing backfill", async () => {
  const missingPath = path.join(
    os.tmpdir(),
    "murph-imessage-missing",
    "TemporaryItems",
    "com.apple.imagent",
    "missing.jpg",
  );
  const captures: InboundCapture[] = [];
  const connector = createImessageConnector({
    driver: {
      async getMessages() {
        return {
          messages: [
            {
              guid: "im-ephemeral-missing",
              chatGuid: "chat-ephemeral-missing",
              date: "2026-03-13T08:00:00.000Z",
              attachments: [
                {
                  id: "att-ephemeral-missing",
                  path: missingPath,
                  filename: "missing.jpg",
                  mimeType: "image/jpeg",
                  size: 15,
                },
              ],
            },
          ],
        };
      },
      async startWatching() {},
    },
    accountId: "self",
  });

  await connector.backfill(null, async (capture: InboundCapture) => {
    captures.push(capture);
    return createPersistedCapture(capture);
  });

  const attachment = captures[0]?.attachments[0];
  assert.ok(attachment);
  assert.equal(attachment.originalPath, null);
  assert.equal(attachment.data ?? null, null);
});

test("runPollConnector backfills and watches iMessage messages while advancing the cursor", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-imessage-run");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  type RuntimeWatcher = (message: Record<string, unknown>) => Promise<void> | void;
  let watcher: RuntimeWatcher | null = null;
  let closeCount = 0;
  const driver = {
    async getMessages() {
      return {
        messages: [
          {
            guid: "im-1",
            text: "Backfill capture",
            date: "2026-03-13T08:00:00.000Z",
            isFromMe: false,
            chatGuid: "chat-1",
            handleId: "friend",
          },
        ],
      };
    },
    async startWatching(options: {
      onMessage(message: Record<string, unknown>): Promise<void> | void;
    }) {
      watcher = options.onMessage as RuntimeWatcher;
      return {
        close() {
          closeCount += 1;
        },
      };
    },
  };

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const connector = createImessageConnector({
    driver,
    accountId: "self",
  });
  const controller = new AbortController();
  const running = runPollConnector({
    connector,
    pipeline,
    accountId: "self",
    signal: controller.signal,
  });

  for (let attempt = 0; attempt < 50 && watcher === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const activeWatcher =
    watcher ??
    (async (_message: Parameters<RuntimeWatcher>[0]) => {
      throw new TypeError("Expected iMessage watch callback to be registered.");
    });
  await activeWatcher({
    guid: "im-2",
    text: "Watch capture",
    date: "2026-03-13T08:10:00.000Z",
    isFromMe: true,
    chatGuid: "chat-1",
    handleId: "self",
  });
  controller.abort();
  await running;

  const captures = runtime.listCaptures({ limit: 10 });
  assert.equal(captures.length, 2);
  assert.equal(captures[0]?.externalId, "im-2");
  assert.deepEqual(runtime.getCursor("imessage", "self"), {
    occurredAt: "2026-03-13T08:10:00.000Z",
    externalId: "im-2",
    receivedAt: null,
  });
  assert.equal(closeCount, 1);

  pipeline.close();
});
