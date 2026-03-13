import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";

import { initializeVault, readJsonlRecords } from "@healthybob/core";

import {
  createConnectorRegistry,
  createInboxPipeline,
  createImessageConnector,
  normalizeImessageMessage,
  openInboxRuntime,
  rebuildRuntimeFromVault,
  runPollConnector,
} from "../src/index.js";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

test("processCapture stores redacted raw evidence, note events, audit records, and attachment jobs", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-vault");
  const sourceRoot = await makeTempDirectory("healthybob-inbox-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "meal-photo.jpg", "photo");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const first = await pipeline.processCapture({
    source: "imessage",
    externalId: "msg-1",
    accountId: "self",
    thread: {
      id: "chat-1",
      title: "Breakfast",
      isDirect: false,
    },
    actor: {
      id: "contact-1",
      displayName: "Friend",
      isSelf: false,
    },
    occurredAt: "2026-03-13T08:00:00.000Z",
    receivedAt: "2026-03-13T08:00:05.000Z",
    text: "Eggs and toast",
    attachments: [
      {
        externalId: "att-1",
        kind: "image",
        mime: "image/jpeg",
        originalPath: attachmentPath,
        fileName: "breakfast.jpg",
      },
    ],
    raw: {
      localPath: "/Users/<REDACTED_USER>/Library/Messages/chat.db",
      nested: {
        attachmentPath: "/home/<REDACTED_USER>/Attachments/foo.jpg",
      },
    },
  });

  const duplicate = await pipeline.processCapture({
    source: "imessage",
    externalId: "msg-1",
    accountId: "self",
    thread: {
      id: "chat-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T08:00:00.000Z",
    text: "duplicate",
    attachments: [],
    raw: {},
  });

  assert.equal(first.deduped, false);
  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.captureId, first.captureId);

  const capture = runtime.getCapture(first.captureId);
  assert.ok(capture);
  assert.equal(capture.accountId, "self");
  assert.equal(capture.text, "Eggs and toast");
  assert.equal(capture.attachments.length, 1);
  assert.match(capture.attachments[0]?.attachmentId ?? "", /^att_/u);
  assert.equal(capture.attachments[0]?.parseState, "pending");
  assert.equal(capture.attachments[0]?.originalPath, null);
  assert.equal(capture.attachments[0]?.storedPath?.startsWith("raw/inbox/imessage/self/"), true);
  assert.equal(capture.raw.localPath, "<REDACTED_PATH>");
  assert.deepEqual(capture.raw.nested, {
    attachmentPath: "<REDACTED_PATH>",
  });

  const jobs = runtime.listAttachmentParseJobs({ limit: 10 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.captureId, first.captureId);
  assert.equal(jobs[0]?.attachmentId, capture.attachments[0]?.attachmentId);
  assert.equal(jobs[0]?.state, "pending");

  const envelopePath = path.join(vaultRoot, capture.envelopePath);
  const envelope = JSON.parse(await fs.readFile(envelopePath, "utf8")) as {
    eventId: string;
    input: {
      attachments: Array<{ originalPath: string | null }>;
      raw: Record<string, unknown>;
    };
    stored: {
      eventId: string;
      attachments: Array<{ attachmentId: string }>;
    };
  };
  assert.equal(envelope.eventId, first.eventId);
  assert.equal(envelope.stored.eventId, first.eventId);
  assert.equal(envelope.input.attachments[0]?.originalPath, null);
  assert.equal(envelope.input.raw.localPath, "<REDACTED_PATH>");
  assert.match(envelope.stored.attachments[0]?.attachmentId ?? "", /^att_/u);

  const eventRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/events/2026/2026-03.jsonl",
  });
  assert.equal(eventRecords.length, 1);
  assert.equal(eventRecords[0]?.kind, "note");
  assert.equal(
    Array.isArray(eventRecords[0]?.rawRefs) &&
      eventRecords[0]?.rawRefs.includes(capture.envelopePath),
    true,
  );

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "audit/2026/2026-03.jsonl",
  });
  assert.equal(auditRecords.length, 2);
  assert.equal(auditRecords.at(-1)?.action, "intake_import");

  pipeline.close();
});

test("runtime search indexes attachment metadata and can rebuild from envelope files", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-search-vault");
  const sourceRoot = await makeTempDirectory("healthybob-inbox-search-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "toast.jpg", "image");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "toast-1",
    thread: {
      id: "chat-breakfast",
    },
    actor: {
      isSelf: true,
    },
    occurredAt: "2026-03-13T09:00:00.000Z",
    text: "Toast with avocado",
    attachments: [
      {
        kind: "image",
        originalPath: imagePath,
        fileName: "toast-photo.jpg",
      },
    ],
    raw: {},
  });

  const hits = runtime.searchCaptures({
    text: "toast",
    limit: 10,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.captureId, capture.captureId);
  assert.match(hits[0]?.snippet ?? "", /Toast with avocado/);

  const fallbackHits = runtime.searchCaptures({
    text: "   ",
    limit: 10,
  });
  assert.equal(fallbackHits.length, 1);
  assert.equal(fallbackHits[0]?.captureId, capture.captureId);
  assert.match(fallbackHits[0]?.snippet ?? "", /Toast with avocado/);

  const rebuiltRuntime = await openInboxRuntime({ vaultRoot });
  await rebuildRuntimeFromVault({
    vaultRoot,
    runtime: rebuiltRuntime,
  });
  const rebuilt = rebuiltRuntime.getCapture(capture.captureId);
  assert.ok(rebuilt);
  assert.equal(rebuilt.text, "Toast with avocado");
  assert.equal(rebuilt.attachments[0]?.fileName, "toast-photo.jpg");
  assert.equal(
    rebuilt.attachments[0]?.attachmentId,
    runtime.getCapture(capture.captureId)?.attachments[0]?.attachmentId,
  );

  pipeline.close();
  rebuiltRuntime.close();
});

test("completed attachment parse jobs refresh capture search text and attachment metadata", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-parse-vault");
  const sourceRoot = await makeTempDirectory("healthybob-inbox-parse-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "lab-result.png", "image");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "imessage",
    externalId: "lab-1",
    thread: {
      id: "chat-lab",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T10:00:00.000Z",
    text: null,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        originalPath: imagePath,
        fileName: "lab-result.png",
      },
    ],
    raw: {},
  });

  const pendingJob = runtime.claimNextAttachmentParseJob();
  assert.ok(pendingJob);
  assert.equal(runtime.getCapture(capture.captureId)?.attachments[0]?.parseState, "running");
  runtime.completeAttachmentParseJob({
    jobId: pendingJob.jobId,
    providerId: "fake-image-parser",
    resultPath: "derived/inbox/manifest.json",
    extractedText: "Glucose 88 mg/dL",
  });

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
  assert.equal(refreshed.attachments[0]?.parserProviderId, "fake-image-parser");
  assert.equal(refreshed.attachments[0]?.derivedPath, "derived/inbox/manifest.json");
  assert.equal(refreshed.attachments[0]?.extractedText, "Glucose 88 mg/dL");

  const hits = runtime.searchCaptures({
    text: "glucose",
    limit: 10,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.captureId, capture.captureId);
  assert.match(hits[0]?.snippet ?? "", /Glucose 88 mg\/dL/);

  pipeline.close();
});

test("runtime list and search filters stay scoped across both search branches", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-filter-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const selfCapture = await pipeline.processCapture({
    source: "imessage",
    externalId: "filter-imessage-self",
    accountId: "self",
    thread: {
      id: "chat-filter",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T09:00:00.000Z",
    text: "toast for self",
    attachments: [],
    raw: {},
  });
  await pipeline.processCapture({
    source: "imessage",
    externalId: "filter-imessage-other",
    accountId: "other",
    thread: {
      id: "chat-filter",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T09:05:00.000Z",
    text: "toast for other",
    attachments: [],
    raw: {},
  });
  await pipeline.processCapture({
    source: "mail",
    externalId: "filter-mail-self",
    accountId: "self",
    thread: {
      id: "chat-filter",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T09:10:00.000Z",
    text: "toast from mail",
    attachments: [],
    raw: {},
  });

  assert.deepEqual(
    runtime.listCaptures({
      source: "imessage",
      accountId: "self",
      limit: 10,
    }).map((capture) => capture.captureId),
    [selfCapture.captureId],
  );
  assert.deepEqual(
    runtime.searchCaptures({
      text: "toast",
      source: "imessage",
      accountId: "self",
      limit: 10,
    }).map((capture) => capture.captureId),
    [selfCapture.captureId],
  );
  assert.deepEqual(
    runtime.searchCaptures({
      text: "   ",
      source: "imessage",
      accountId: "self",
      limit: 10,
    }).map((capture) => capture.captureId),
    [selfCapture.captureId],
  );

  pipeline.close();
});

test("runtime decoding rejects malformed sqlite rows with clear column errors", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-malformed-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const database = new DatabaseSync(runtime.databasePath);

  database
    .prepare(
      `
        insert into capture (
          capture_id,
          source,
          account_id,
          external_id,
          thread_id,
          thread_title,
          thread_is_direct,
          actor_id,
          actor_name,
          actor_is_self,
          occurred_at,
          received_at,
          text_content,
          raw_json,
          vault_event_id,
          envelope_path,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      "cap-malformed",
      "imessage",
      "",
      "malformed-1",
      "chat-malformed",
      null,
      "nope",
      null,
      null,
      0,
      "2026-03-13T10:00:00.000Z",
      null,
      "toast",
      "{}",
      "evt-malformed",
      "raw/inbox/imessage/self/2026/03/13/cap-malformed.json",
      "2026-03-13T10:00:00.000Z",
    );

  database.close();

  assert.throws(
    () => runtime.getCapture("cap-malformed"),
    /Expected capture.thread_is_direct to be a number/,
  );

  runtime.close();
});

test("runPollConnector backfills and watches iMessage messages while advancing the cursor", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-inbox-daemon-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  let watcher: ((message: Record<string, unknown>) => Promise<void> | void) | null = null;
  let closeCount = 0;
  const driver = {
    async getMessages() {
      return [
        {
          guid: "im-1",
          text: "Backfill capture",
          date: "2026-03-13T08:00:00.000Z",
          isFromMe: false,
          chatGuid: "chat-1",
          handleId: "friend",
        },
      ];
    },
    async startWatching(options: {
      onMessage(message: Record<string, unknown>): Promise<void> | void;
    }) {
      watcher = options.onMessage;
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

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(watcher);
  await watcher?.({
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

test("normalizeImessageMessage trims text, sanitizes raw keys, and registry kind checks stay explicit", () => {
  const capture = normalizeImessageMessage({
    message: {
      guid: "im-raw-1",
      chatGuid: "chat-raw-1",
      text: "  hello from raw  ",
      date: new Date("2026-03-13T10:00:00.000Z"),
      attachments: null,
      ["display-name"]: "Friend",
      nested: {
        ["child-key"]: new Date("2026-03-13T10:00:01.000Z"),
      },
    },
    chat: {
      participantCount: 3,
    },
  });

  assert.equal(capture.text, "hello from raw");
  assert.equal(capture.thread.isDirect, false);
  assert.equal(capture.raw.display_name, "Friend");
  assert.deepEqual(capture.raw.nested, {
    child_key: "2026-03-13T10:00:01.000Z",
  });

  const registry = createConnectorRegistry([
    {
      source: "imessage",
      kind: "poll",
      capabilities: {
        backfill: false,
        watch: false,
        webhooks: false,
        attachments: true,
      },
      async backfill(_cursor, _emit) {
        return null;
      },
      async watch(_cursor, _emit, _signal) {},
    },
  ]);

  assert.equal(registry.requirePoll("imessage").source, "imessage");
  assert.throws(
    () => registry.requireWebhook("imessage"),
    /Webhook connector not registered for source: imessage/,
  );
});

test("normalizeImessageMessage treats non-string text payloads as null", () => {
  const malformedMessage = {
    guid: "im-raw-2",
    chatGuid: "chat-raw-2",
    text: 42,
    date: "2026-03-13T10:02:00.000Z",
  } as unknown as Parameters<typeof normalizeImessageMessage>[0]["message"];

  const capture = normalizeImessageMessage({
    message: malformedMessage,
  });

  assert.equal(capture.text, null);
});
