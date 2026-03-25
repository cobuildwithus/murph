import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { InboundCapture, PersistedCapture } from "../src/contracts/capture.js";
import { createImessageConnector } from "../src/connectors/imessage/connector.js";
import { normalizeImessageMessage } from "../src/connectors/imessage/normalize.js";
import type { PollConnector } from "../src/connectors/types.js";
import { runInboxDaemon, runPollConnector } from "../src/kernel/daemon.js";
import { createConnectorRegistry } from "../src/kernel/registry.js";

test("connector registry keeps distinct runtime ids under the same source family", () => {
  const left = createStubPollConnector({
    id: "imessage:self",
    source: "imessage",
    accountId: "self",
  });
  const right = createStubPollConnector({
    id: "imessage:work",
    source: "imessage",
    accountId: "work",
  });
  const registry = createConnectorRegistry([left, right]);

  assert.equal(registry.get("imessage:self")?.id, "imessage:self");
  assert.equal(registry.requirePoll("imessage:work").accountId, "work");
  assert.deepEqual(
    registry.listBySource("imessage").map((connector) => connector.id),
    ["imessage:self", "imessage:work"],
  );
  assert.equal(registry.get("imessage"), null);
  assert.throws(
    () => registry.requirePoll("imessage"),
    /Multiple connectors registered for source: imessage\. Use a connector id\./,
  );
  assert.throws(
    () => registry.requireWebhook("imessage:self"),
    /Webhook connector not registered for id: imessage:self/,
  );
  assert.throws(
    () =>
      createConnectorRegistry([
        createStubPollConnector({
          id: "   ",
          source: "imessage",
        }),
        createStubPollConnector({
          id: "   ",
          source: "imessage",
        }),
      ]),
    /Connector id is required when multiple connectors share source: imessage/,
  );
});

test("normalizeImessageMessage does not treat dateRead as receivedAt", () => {
  const capture = normalizeImessageMessage({
    message: {
      guid: "im-read-only",
      chatGuid: "chat-read-only",
      date: "2026-03-13T10:00:00.000Z",
      dateRead: "2026-03-13T10:05:00.000Z",
    },
  });

  assert.equal(capture.receivedAt, null);
});

test("normalizeImessageMessage prefers delivery timestamps over read timestamps with a stable precedence order", () => {
  const fromReceived = normalizeImessageMessage({
    message: {
      guid: "im-received",
      chatGuid: "chat-received",
      date: "2026-03-13T10:00:00.000Z",
      dateReceived: "2026-03-13T10:01:00.000Z",
      dateDelivered: "2026-03-13T10:02:00.000Z",
      dateRead: "2026-03-13T10:03:00.000Z",
    },
  });
  const fromDelivered = normalizeImessageMessage({
    message: {
      guid: "im-delivered",
      chatGuid: "chat-delivered",
      date: "2026-03-13T10:00:00.000Z",
      dateDelivered: "2026-03-13T10:02:00.000Z",
      dateRead: "2026-03-13T10:03:00.000Z",
    },
  });
  const fallbackAfterInvalid = normalizeImessageMessage({
    message: {
      guid: "im-fallback",
      chatGuid: "chat-fallback",
      date: "2026-03-13T10:00:00.000Z",
      dateReceived: "",
      dateDelivered: "2026-03-13T10:04:00.000Z",
    },
  });

  assert.equal(fromReceived.receivedAt, "2026-03-13T10:01:00.000Z");
  assert.equal(fromDelivered.receivedAt, "2026-03-13T10:02:00.000Z");
  assert.equal(fallbackAfterInvalid.receivedAt, "2026-03-13T10:04:00.000Z");
});

test("createImessageConnector loads chats lazily and refreshes metadata when a watch message misses cache", async () => {
  const emitted: InboundCapture[] = [];
  let listChatsCalls = 0;
  let watcher:
    | ((message: {
        guid: string;
        chatGuid: string;
        date: string;
        text: string;
      }) => Promise<void>)
    | null = null;
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
        watcher = options.onMessage as typeof watcher;
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

  await connector.backfill(null, async (capture) => {
    emitted.push(capture);
    return createPersistedCapture(capture);
  });

  assert.equal(listChatsCalls, 1);
  assert.equal(emitted[0]?.thread.title, "Known Chat");

  const controller = new AbortController();
  const running = connector.watch(
    null,
    async (capture) => {
      emitted.push(capture);
      return createPersistedCapture(capture);
    },
    controller.signal,
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  await watcher?.({
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

  await explicitNull.backfill(null, async (capture) => {
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
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "healthybob-imessage-ephemeral-"));
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

  await connector.backfill(null, async (capture) => {
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
    "healthybob-imessage-missing",
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

  await connector.backfill(null, async (capture) => {
    captures.push(capture);
    return createPersistedCapture(capture);
  });

  const attachment = captures[0]?.attachments[0];
  assert.ok(attachment);
  assert.equal(attachment.originalPath, null);
  assert.equal(attachment.data ?? null, null);
});

test("runPollConnector keeps cursor writes scoped to the connector account id", async () => {
  const cursorWrites: Array<string | null | undefined> = [];

  await runPollConnector({
    connector: createStubPollConnector({
      id: "imessage:self",
      source: "imessage",
      accountId: "self",
      async backfill(cursor, emit) {
        assert.equal(cursor, null);

        await emit({
          source: "imessage",
          externalId: "im-account-scope",
          accountId: "other",
          thread: {
            id: "chat-account-scope",
          },
          actor: {
            isSelf: false,
          },
          occurredAt: "2026-03-13T09:00:00.000Z",
          text: "Scoped cursor write",
          attachments: [],
          raw: {},
        });

        return {
          occurredAt: "2026-03-13T09:00:00.000Z",
          externalId: "im-account-scope",
          receivedAt: null,
        };
      },
    }),
    pipeline: {
      runtime: {
        databasePath: ":memory:",
        close() {},
        getCursor() {
          return null;
        },
        setCursor(_source, accountId) {
          cursorWrites.push(accountId);
        },
        findByExternalId() {
          return null;
        },
        upsertCaptureIndex() {},
        enqueueDerivedJobs() {},
        listAttachmentParseJobs() {
          return [];
        },
        claimNextAttachmentParseJob() {
          return null;
        },
        requeueAttachmentParseJobs() {
          return 0;
        },
        completeAttachmentParseJob() {
          throw new Error("completeAttachmentParseJob should not be called");
        },
        failAttachmentParseJob() {
          throw new Error("failAttachmentParseJob should not be called");
        },
        listCaptures() {
          return [];
        },
        searchCaptures() {
          return [];
        },
        getCapture() {
          return null;
        },
      },
      async processCapture(input) {
        return createPersistedCapture(input);
      },
      close() {},
    },
    signal: new AbortController().signal,
  });

  assert.deepEqual(cursorWrites, ["self", "self"]);
});



test("runPollConnector uses connector-supplied checkpoints when emitting captures", async () => {
  const cursorWrites: Array<Record<string, unknown> | null> = [];

  await runPollConnector({
    connector: createStubPollConnector({
      id: "telegram:bot",
      source: "telegram",
      accountId: "bot",
      async backfill(cursor, emit) {
        assert.equal(cursor, null);

        await emit(
          {
            source: "telegram",
            externalId: "update:42",
            accountId: "bot",
            thread: {
              id: "123",
            },
            actor: {
              isSelf: false,
            },
            occurredAt: "2026-03-13T09:00:00.000Z",
            text: "Scoped checkpoint write",
            attachments: [],
            raw: {},
          },
          { updateId: 42 },
        );

        return { updateId: 42 };
      },
    }),
    pipeline: {
      runtime: {
        databasePath: ":memory:",
        close() {},
        getCursor() {
          return null;
        },
        setCursor(_source, _accountId, cursor) {
          cursorWrites.push(cursor);
        },
        findByExternalId() {
          return null;
        },
        upsertCaptureIndex() {},
        enqueueDerivedJobs() {},
        listAttachmentParseJobs() {
          return [];
        },
        claimNextAttachmentParseJob() {
          return null;
        },
        requeueAttachmentParseJobs() {
          return 0;
        },
        completeAttachmentParseJob() {
          throw new Error("completeAttachmentParseJob should not be called");
        },
        failAttachmentParseJob() {
          throw new Error("failAttachmentParseJob should not be called");
        },
        listCaptures() {
          return [];
        },
        searchCaptures() {
          return [];
        },
        getCapture() {
          return null;
        },
      },
      async processCapture(input) {
        return createPersistedCapture(input);
      },
      close() {},
    },
    signal: new AbortController().signal,
  });

  assert.deepEqual(cursorWrites, [{ updateId: 42 }, { updateId: 42 }]);
});

test("runPollConnector retries watch failures from the latest emitted cursor when restart is enabled", async () => {
  const cursorWrites: Array<Record<string, unknown> | null> = [];
  const seenWatchCursors: Array<Record<string, unknown> | null> = [];
  let watchCalls = 0;

  await runPollConnector({
    connector: createStubPollConnector({
      id: "email:agentmail",
      source: "email",
      accountId: "agentmail",
      async backfill(cursor, emit) {
        assert.equal(cursor, null);

        await emit(
          {
            source: "email",
            externalId: "email:msg-1",
            accountId: "agentmail",
            thread: {
              id: "thread-1",
            },
            actor: {
              isSelf: false,
            },
            occurredAt: "2026-03-13T09:00:00.000Z",
            text: "backfill",
            attachments: [],
            raw: {},
          },
          { messageId: "msg-1" },
        );

        return { messageId: "msg-1" };
      },
      async watch(cursor, emit) {
        seenWatchCursors.push(cursor);
        watchCalls += 1;

        if (watchCalls === 1) {
          await emit(
            {
              source: "email",
              externalId: "email:msg-2",
              accountId: "agentmail",
              thread: {
                id: "thread-1",
              },
              actor: {
                isSelf: false,
              },
              occurredAt: "2026-03-13T09:01:00.000Z",
              text: "first watch attempt",
              attachments: [],
              raw: {},
            },
            { messageId: "msg-2" },
          );

          throw new Error("watch exploded");
        }

        assert.deepEqual(cursor, { messageId: "msg-2" });

        await emit(
          {
            source: "email",
            externalId: "email:msg-3",
            accountId: "agentmail",
            thread: {
              id: "thread-1",
            },
            actor: {
              isSelf: false,
            },
            occurredAt: "2026-03-13T09:02:00.000Z",
            text: "second watch attempt",
            attachments: [],
            raw: {},
          },
          { messageId: "msg-3" },
        );
      },
    }),
    pipeline: {
      runtime: {
        databasePath: ":memory:",
        close() {},
        getCursor() {
          return null;
        },
        setCursor(_source, _accountId, cursor) {
          cursorWrites.push(cursor);
        },
        findByExternalId() {
          return null;
        },
        upsertCaptureIndex() {},
        enqueueDerivedJobs() {},
        listAttachmentParseJobs() {
          return [];
        },
        claimNextAttachmentParseJob() {
          return null;
        },
        requeueAttachmentParseJobs() {
          return 0;
        },
        completeAttachmentParseJob() {
          throw new Error("completeAttachmentParseJob should not be called");
        },
        failAttachmentParseJob() {
          throw new Error("failAttachmentParseJob should not be called");
        },
        listCaptures() {
          return [];
        },
        searchCaptures() {
          return [];
        },
        getCapture() {
          return null;
        },
      },
      async processCapture(input) {
        return createPersistedCapture(input);
      },
      close() {},
    },
    signal: new AbortController().signal,
    restartConnectorOnFailure: true,
    connectorRestartDelayMs: 1,
    maxConnectorRestartDelayMs: 4,
  });

  assert.equal(watchCalls, 2);
  assert.deepEqual(seenWatchCursors, [{ messageId: "msg-1" }, { messageId: "msg-2" }]);
  assert.deepEqual(cursorWrites, [
    { messageId: "msg-1" },
    { messageId: "msg-1" },
    { messageId: "msg-2" },
    { messageId: "msg-3" },
  ]);
});

test("runInboxDaemon aborts sibling connectors and waits for their cleanup when one fails", async () => {
  let runningConnectorAborted = false;
  let runningConnectorClosed = 0;
  const runningConnector = createStubPollConnector({
    id: "imessage:self",
    source: "imessage",
    accountId: "self",
    async watch(_cursor, _emit, signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          runningConnectorAborted = true;
          resolve();
          return;
        }

        signal.addEventListener(
          "abort",
          () => {
            runningConnectorAborted = true;
            resolve();
          },
          { once: true },
        );
      });
    },
    async close() {
      runningConnectorClosed += 1;
    },
  });
  const failingConnector = createStubPollConnector({
    id: "imessage:work",
    source: "imessage",
    accountId: "work",
    async watch() {
      throw new Error("watch exploded");
    },
  });

  await assert.rejects(
    () =>
      runInboxDaemon({
        pipeline: {
          runtime: {
            databasePath: ":memory:",
            close() {},
            getCursor() {
              return null;
            },
            setCursor() {},
            findByExternalId() {
              return null;
            },
            upsertCaptureIndex() {},
            enqueueDerivedJobs() {},
            listAttachmentParseJobs() {
              return [];
            },
            claimNextAttachmentParseJob() {
              return null;
            },
            requeueAttachmentParseJobs() {
              return 0;
            },
            completeAttachmentParseJob() {
              throw new Error("completeAttachmentParseJob should not be called");
            },
            failAttachmentParseJob() {
              throw new Error("failAttachmentParseJob should not be called");
            },
            listCaptures() {
              return [];
            },
            searchCaptures() {
              return [];
            },
            getCapture() {
              return null;
            },
          },
          async processCapture(_input) {
            throw new Error("processCapture should not be called");
          },
        },
        connectors: [runningConnector, failingConnector],
        signal: new AbortController().signal,
      }),
    /Connector "imessage:work" \(imessage\) failed: watch exploded/,
  );

  assert.equal(runningConnectorAborted, true);
  assert.equal(runningConnectorClosed, 1);
});

test("runInboxDaemon aggregates wrapped connector failures when multiple connectors throw", async () => {
  const left = createStubPollConnector({
    id: "imessage:self",
    source: "imessage",
    accountId: "self",
    async watch() {
      throw new Error("left exploded");
    },
  });
  const right = createStubPollConnector({
    id: "imessage:work",
    source: "imessage",
    accountId: "work",
    async watch() {
      throw new Error("right exploded");
    },
  });

  await assert.rejects(
    () =>
      runInboxDaemon({
        pipeline: {
          runtime: {
            databasePath: ":memory:",
            close() {},
            getCursor() {
              return null;
            },
            setCursor() {},
            findByExternalId() {
              return null;
            },
            upsertCaptureIndex() {},
            enqueueDerivedJobs() {},
            listAttachmentParseJobs() {
              return [];
            },
            claimNextAttachmentParseJob() {
              return null;
            },
            requeueAttachmentParseJobs() {
              return 0;
            },
            completeAttachmentParseJob() {
              throw new Error("completeAttachmentParseJob should not be called");
            },
            failAttachmentParseJob() {
              throw new Error("failAttachmentParseJob should not be called");
            },
            listCaptures() {
              return [];
            },
            searchCaptures() {
              return [];
            },
            getCapture() {
              return null;
            },
          },
          async processCapture(_input) {
            throw new Error("processCapture should not be called");
          },
          close() {},
        },
        connectors: [left, right],
        signal: new AbortController().signal,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, "Inbox daemon stopped after connector failures.");
      const messages = error.errors.map((entry) =>
        entry instanceof Error ? entry.message : String(entry),
      );
      assert.deepEqual(messages.sort(), [
        'Connector "imessage:self" (imessage) failed: left exploded',
        'Connector "imessage:work" (imessage) failed: right exploded',
      ]);
      return true;
    },
  );
});

test("runInboxDaemon can keep sibling connectors alive after a connector failure", async () => {
  const controller = new AbortController();
  let runningConnectorAborted = false;
  let runningConnectorClosed = 0;
  let sawFailingConnectorClose = false;
  let resolveFailingConnectorClose: (() => void) | null = null;
  const failingConnectorClosed = new Promise<void>((resolve) => {
    resolveFailingConnectorClose = resolve;
  });

  const runningConnector = createStubPollConnector({
    id: "email:agentmail",
    source: "email",
    accountId: "agentmail",
    async watch(_cursor, _emit, signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          runningConnectorAborted = true;
          resolve();
          return;
        }

        signal.addEventListener(
          "abort",
          () => {
            runningConnectorAborted = true;
            resolve();
          },
          { once: true },
        );
      });
    },
    async close() {
      runningConnectorClosed += 1;
    },
  });
  const failingConnector = createStubPollConnector({
    id: "imessage:self",
    source: "imessage",
    accountId: "self",
    async watch() {
      throw new Error("watch exploded");
    },
    async close() {
      sawFailingConnectorClose = true;
      resolveFailingConnectorClose?.();
    },
  });

  const running = runInboxDaemon({
    pipeline: {
      runtime: {
        databasePath: ":memory:",
        close() {},
        getCursor() {
          return null;
        },
        setCursor() {},
        findByExternalId() {
          return null;
        },
        upsertCaptureIndex() {},
        enqueueDerivedJobs() {},
        listAttachmentParseJobs() {
          return [];
        },
        claimNextAttachmentParseJob() {
          return null;
        },
        requeueAttachmentParseJobs() {
          return 0;
        },
        completeAttachmentParseJob() {
          throw new Error("completeAttachmentParseJob should not be called");
        },
        failAttachmentParseJob() {
          throw new Error("failAttachmentParseJob should not be called");
        },
        listCaptures() {
          return [];
        },
        searchCaptures() {
          return [];
        },
        getCapture() {
          return null;
        },
      },
      async processCapture(_input) {
        throw new Error("processCapture should not be called");
      },
      close() {},
    },
    connectors: [runningConnector, failingConnector],
    signal: controller.signal,
    continueOnConnectorFailure: true,
  });

  await failingConnectorClosed;
  assert.equal(sawFailingConnectorClose, true);
  assert.equal(runningConnectorAborted, false);

  controller.abort();
  await running;

  assert.equal(runningConnectorAborted, true);
  assert.equal(runningConnectorClosed, 1);
});

test("runInboxDaemon restarts failed connectors when restart-on-failure is enabled", async () => {
  const controller = new AbortController();
  let watchCalls = 0;
  let resolveRestarted!: () => void;
  const restarted = new Promise<void>((resolve) => {
    resolveRestarted = resolve;
  });

  const connector = createStubPollConnector({
    id: "email:agentmail",
    source: "email",
    accountId: "agentmail",
    async watch(_cursor, _emit, signal) {
      watchCalls += 1;

      if (watchCalls === 1) {
        throw new Error("watch exploded");
      }

      resolveRestarted();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }

        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });

  const running = runInboxDaemon({
    pipeline: {
      runtime: {
        databasePath: ":memory:",
        close() {},
        getCursor() {
          return null;
        },
        setCursor() {},
        findByExternalId() {
          return null;
        },
        upsertCaptureIndex() {},
        enqueueDerivedJobs() {},
        listAttachmentParseJobs() {
          return [];
        },
        claimNextAttachmentParseJob() {
          return null;
        },
        requeueAttachmentParseJobs() {
          return 0;
        },
        completeAttachmentParseJob() {
          throw new Error("completeAttachmentParseJob should not be called");
        },
        failAttachmentParseJob() {
          throw new Error("failAttachmentParseJob should not be called");
        },
        listCaptures() {
          return [];
        },
        searchCaptures() {
          return [];
        },
        getCapture() {
          return null;
        },
      },
      async processCapture(_input) {
        throw new Error("processCapture should not be called");
      },
      close() {},
    },
    connectors: [connector],
    signal: controller.signal,
    continueOnConnectorFailure: true,
    restartConnectorOnFailure: true,
    connectorRestartDelayMs: 1,
    maxConnectorRestartDelayMs: 4,
  });

  await restarted;
  controller.abort();
  await running;

  assert.equal(watchCalls, 2);
});

test("runInboxDaemon still rejects when every connector fails in isolation mode", async () => {
  const left = createStubPollConnector({
    id: "imessage:self",
    source: "imessage",
    accountId: "self",
    async watch() {
      throw new Error("left exploded");
    },
  });
  const right = createStubPollConnector({
    id: "email:agentmail",
    source: "email",
    accountId: "agentmail",
    async watch() {
      throw new Error("right exploded");
    },
  });

  await assert.rejects(
    () =>
      runInboxDaemon({
        pipeline: {
          runtime: {
            databasePath: ":memory:",
            close() {},
            getCursor() {
              return null;
            },
            setCursor() {},
            findByExternalId() {
              return null;
            },
            upsertCaptureIndex() {},
            enqueueDerivedJobs() {},
            listAttachmentParseJobs() {
              return [];
            },
            claimNextAttachmentParseJob() {
              return null;
            },
            requeueAttachmentParseJobs() {
              return 0;
            },
            completeAttachmentParseJob() {
              throw new Error("completeAttachmentParseJob should not be called");
            },
            failAttachmentParseJob() {
              throw new Error("failAttachmentParseJob should not be called");
            },
            listCaptures() {
              return [];
            },
            searchCaptures() {
              return [];
            },
            getCapture() {
              return null;
            },
          },
          async processCapture(_input) {
            throw new Error("processCapture should not be called");
          },
          close() {},
        },
        connectors: [left, right],
        signal: new AbortController().signal,
        continueOnConnectorFailure: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, "Inbox daemon stopped after connector failures.");
      const messages = error.errors.map((entry) =>
        entry instanceof Error ? entry.message : String(entry),
      );
      assert.deepEqual(messages.sort(), [
        'Connector "email:agentmail" (email) failed: right exploded',
        'Connector "imessage:self" (imessage) failed: left exploded',
      ]);
      return true;
    },
  );
});

function createStubPollConnector(input: {
  id: string;
  source: string;
  accountId?: string | null;
  backfill?: PollConnector["backfill"];
  watch?: PollConnector["watch"];
  close?: PollConnector["close"];
}): PollConnector {
  return {
    id: input.id,
    source: input.source,
    accountId: input.accountId ?? null,
    kind: "poll",
    capabilities: {
      backfill: input.backfill !== undefined,
      watch: input.watch !== undefined,
      webhooks: false,
      attachments: true,
    },
    async backfill(cursor, emit) {
      if (!input.backfill) {
        return cursor;
      }

      return input.backfill(cursor, emit);
    },
    async watch(cursor, emit, signal) {
      if (!input.watch) {
        return;
      }

      await input.watch(cursor, emit, signal);
    },
    close: input.close,
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
