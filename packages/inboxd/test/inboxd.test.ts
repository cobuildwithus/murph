import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { resolveRuntimePaths } from "@murphai/runtime-state/node";

import { initializeVault, isVaultError, readJsonlRecords } from "@murphai/core";

import {
  createConnectorRegistry,
  createInboxPipeline,
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
  rebuildRuntimeFromVault,
  runPollConnector,
} from "../src/index.ts";
import {
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "../src/shared.ts";

const require = createRequire(import.meta.url);

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function readJsonlRecordsIfPresent(vaultRoot: string, relativePath: string): Promise<unknown[]> {
  try {
    return await readJsonlRecords({ vaultRoot, relativePath });
  } catch (error) {
    if (isVaultError(error) && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

    throw error;
  }
}

test("toIsoTimestamp rejects invalid values with the inbox-specific TypeError", () => {
  assert.throws(
    () => toIsoTimestamp("not-a-timestamp"),
    (error) =>
      error instanceof TypeError &&
      error.message === "Invalid ISO timestamp: not-a-timestamp",
  );
});

test("processCapture stores redacted raw evidence, one canonical intake record, and attachment jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "meal-notes.pdf", "document");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  assert.equal(runtime.databasePath, resolveRuntimePaths(vaultRoot).inboxDbPath);

  const first = await pipeline.processCapture({
    source: "email",
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
        kind: "document",
        mime: "application/pdf",
        originalPath: attachmentPath,
        fileName: "breakfast.pdf",
      },
    ],
    raw: {
      localPath: "/Users/<REDACTED_USER>/Documents/inbox-source/capture.sqlite",
      authorization: "Bearer <AUTH_SECRET>",
      cookie: "session=<COOKIE_SECRET>",
      stringifiedAuth: "Authorization: Bearer <AUTH_SECRET>",
      headers: {
        Authorization: "Bearer <AUTH_SECRET>",
        "set-cookie": "session=<COOKIE_SECRET>; Path=/",
      },
      nested: {
        attachmentPath: "/home/<REDACTED_USER>/Downloads/foo.jpg",
        access_token: "<ACCESS_TOKEN>",
        refreshToken: "<REFRESH_TOKEN>",
        api_key: "<API_KEY>",
        secret: "<NESTED_SECRET>",
        session: {
          id: "<SESSION_ID>",
        },
      },
    },
  });

  const duplicate = await pipeline.processCapture({
    source: "email",
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
  assert.equal(capture.attachments[0]?.storedPath?.startsWith("raw/inbox/email/self/"), true);
  assert.equal(capture.raw.localPath, "<REDACTED_PATH>");
  assert.equal(capture.raw.authorization, "<REDACTED_SECRET>");
  assert.equal(capture.raw.cookie, "<REDACTED_SECRET>");
  assert.equal(capture.raw.stringifiedAuth, "<REDACTED_SECRET>");
  assert.deepEqual(capture.raw.headers, {
    Authorization: "<REDACTED_SECRET>",
    "set-cookie": "<REDACTED_SECRET>",
  });
  assert.deepEqual(capture.raw.nested, {
    attachmentPath: "<REDACTED_PATH>",
    access_token: "<REDACTED_SECRET>",
    refreshToken: "<REDACTED_SECRET>",
    api_key: "<REDACTED_SECRET>",
    secret: "<REDACTED_SECRET>",
    session: "<REDACTED_SECRET>",
  });

  const captureDatabase = openDatabaseSync(runtime.databasePath);
  const captureRow = captureDatabase
    .prepare("select raw_json from capture where capture_id = ?")
    .get(first.captureId) as { raw_json: string } | undefined;
  captureDatabase.close();
  assert.ok(captureRow);
  assert.match(captureRow.raw_json, /<REDACTED_SECRET>/u);
  assert.equal(captureRow.raw_json.includes("<AUTH_SECRET>"), false);
  assert.equal(captureRow.raw_json.includes("<ACCESS_TOKEN>"), false);

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
  assert.equal(envelope.input.raw.authorization, "<REDACTED_SECRET>");
  assert.equal(envelope.input.raw.cookie, "<REDACTED_SECRET>");
  assert.equal(envelope.input.raw.stringifiedAuth, "<REDACTED_SECRET>");
  assert.deepEqual(envelope.input.raw.headers, {
    Authorization: "<REDACTED_SECRET>",
    "set-cookie": "<REDACTED_SECRET>",
  });
  assert.deepEqual(envelope.input.raw.nested, {
    attachmentPath: "<REDACTED_PATH>",
    access_token: "<REDACTED_SECRET>",
    refreshToken: "<REDACTED_SECRET>",
    api_key: "<REDACTED_SECRET>",
    secret: "<REDACTED_SECRET>",
    session: "<REDACTED_SECRET>",
  });
  assert.match(envelope.stored.attachments[0]?.attachmentId ?? "", /^att_/u);

  const captureRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });
  assert.equal(captureRecords.length, 1);
  assert.equal(captureRecords[0]?.captureId, first.captureId);
  assert.equal(captureRecords[0]?.eventId, first.eventId);
  assert.equal(captureRecords[0]?.auditId, undefined);
  assert.equal(captureRecords[0]?.envelopePath, capture.envelopePath);
  assert.equal(
    Array.isArray(captureRecords[0]?.rawRefs) &&
      captureRecords[0]?.rawRefs.includes(capture.envelopePath),
    true,
  );

  assert.deepEqual(
    await readJsonlRecordsIfPresent(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
    [],
  );
  assert.deepEqual(
    await readJsonlRecordsIfPresent(
      vaultRoot,
      `audit/${first.createdAt.slice(0, 4)}/${first.createdAt.slice(0, 7)}.jsonl`,
    ),
    [],
  );

  pipeline.close();
});



test("processCapture stores in-memory attachment bytes without an external source path", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-bytes-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const persisted = await pipeline.processCapture({
    source: "telegram",
    externalId: "update:1",
    accountId: "bot",
    thread: {
      id: "chat-telegram",
      isDirect: true,
    },
    actor: {
      id: "111",
      displayName: "Alice",
      isSelf: false,
    },
    occurredAt: "2026-03-13T08:30:00.000Z",
    text: "Photo from Telegram",
    attachments: [
      {
        externalId: "photo-1",
        kind: "image",
        mime: "image/jpeg",
        fileName: "telegram-photo.jpg",
        data: new Uint8Array([7, 8, 9]),
      },
    ],
    raw: {},
  });

  const capture = runtime.getCapture(persisted.captureId);
  assert.ok(capture);
  const storedPath = capture.attachments[0]?.storedPath;
  assert.equal(typeof storedPath, "string");
  assert.deepEqual(
    new Uint8Array(await fs.readFile(path.join(vaultRoot, storedPath ?? ""))),
    new Uint8Array([7, 8, 9]),
  );

  const envelope = JSON.parse(
    await fs.readFile(path.join(vaultRoot, capture.envelopePath), "utf8"),
  ) as {
    input: {
      attachments: Array<Record<string, unknown>>;
    };
  };
  assert.equal(envelope.input.attachments[0]?.originalPath ?? null, null);
  assert.equal("data" in (envelope.input.attachments[0] ?? {}), false);

  pipeline.close();
});

test("listCaptures supports oldest-first paging with a persisted after cursor", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-list-cursor");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  await pipeline.processCapture({
    source: "telegram",
    externalId: "update:1",
    thread: { id: "100" },
    actor: { id: "alice", isSelf: false },
    occurredAt: "2026-03-13T08:00:00.000Z",
    text: "first",
    attachments: [],
    raw: {},
  });
  await pipeline.processCapture({
    source: "telegram",
    externalId: "update:2",
    thread: { id: "100" },
    actor: { id: "alice", isSelf: false },
    occurredAt: "2026-03-13T08:01:00.000Z",
    text: "second",
    attachments: [],
    raw: {},
  });
  await pipeline.processCapture({
    source: "telegram",
    externalId: "update:3",
    thread: { id: "100" },
    actor: { id: "alice", isSelf: false },
    occurredAt: "2026-03-13T08:02:00.000Z",
    text: "third",
    attachments: [],
    raw: {},
  });

  const firstPage = runtime.listCaptures({
    limit: 2,
    oldestFirst: true,
  });
  assert.deepEqual(
    firstPage.map((capture) => capture.text),
    ["first", "second"],
  );

  const secondPage = runtime.listCaptures({
    limit: 2,
    oldestFirst: true,
    afterOccurredAt: firstPage[1]?.occurredAt ?? null,
    afterCaptureId: firstPage[1]?.captureId ?? null,
  });
  assert.deepEqual(
    secondPage.map((capture) => capture.text),
    ["third"],
  );

  const newestFirst = runtime.listCaptures({
    limit: 2,
  });
  assert.deepEqual(
    newestFirst.map((capture) => capture.text),
    ["third", "second"],
  );

  pipeline.close();
});

test("runtime search indexes attachment metadata and can rebuild from envelope files", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-search-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-search-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const imagePath = await writeExternalFile(sourceRoot, "toast.jpg", "image");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "email",
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
  assert.equal(runtime.listAttachmentParseJobs({ limit: 10 }).length, 0);

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
  assert.equal(rebuiltRuntime.listAttachmentParseJobs({ limit: 10 }).length, 0);
  assert.equal(
    rebuilt.attachments[0]?.attachmentId,
    runtime.getCapture(capture.captureId)?.attachments[0]?.attachmentId,
  );

  pipeline.close();
  rebuiltRuntime.close();
});

test("completed attachment parse jobs refresh capture search text and attachment metadata", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-parse-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-parse-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const documentPath = await writeExternalFile(sourceRoot, "lab-result.pdf", "document");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "email",
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
        kind: "document",
        mime: "application/pdf",
        originalPath: documentPath,
        fileName: "lab-result.pdf",
      },
    ],
    raw: {},
  });

  const pendingJob = runtime.claimNextAttachmentParseJob();
  assert.ok(pendingJob);
  assert.equal(runtime.getCapture(capture.captureId)?.attachments[0]?.parseState, "running");
  runtime.completeAttachmentParseJob({
    jobId: pendingJob.jobId,
    attempt: pendingJob.attempts,
    providerId: "fake-document-parser",
    resultPath: "derived/inbox/manifest.json",
    extractedText: "Glucose 88 mg/dL",
  });

  const refreshed = runtime.getCapture(capture.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "succeeded");
  assert.equal(refreshed.attachments[0]?.parserProviderId, "fake-document-parser");
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


test("capture mutation cursors advance for new captures, attachment parse updates, and direct capture rewrites", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-mutation-cursor-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-mutation-cursor-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const documentPath = await writeExternalFile(sourceRoot, "cursor.pdf", "document");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "email",
    externalId: "cursor-1",
    thread: { id: "chat-cursor" },
    actor: { isSelf: false },
    occurredAt: "2026-03-13T11:00:00.000Z",
    text: "Original text",
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: documentPath,
        fileName: "cursor.pdf",
      },
    ],
    raw: {},
  });

  const firstHead = await readInboxCaptureMutationHead(vaultRoot);
  assert.ok(firstHead > 0);
  assert.deepEqual(await listInboxCaptureMutations({ vaultRoot, afterCursor: 0, limit: 10 }), [
    {
      captureId: capture.captureId,
      cursor: firstHead,
    },
  ]);

  const job = runtime.claimNextAttachmentParseJob();
  assert.ok(job);
  runtime.completeAttachmentParseJob({
    jobId: job!.jobId,
    attempt: job!.attempts,
    providerId: "fake-document-parser",
    resultPath: "derived/inbox/cursor.json",
    extractedText: "Parsed cursor text",
  });

  const secondHead = await readInboxCaptureMutationHead(vaultRoot);
  assert.ok(secondHead > firstHead);
  assert.deepEqual(await listInboxCaptureMutations({ vaultRoot, afterCursor: firstHead, limit: 10 }), [
    {
      captureId: capture.captureId,
      cursor: secondHead,
    },
  ]);

  const runtimeDatabase = new DatabaseSync(runtime.databasePath);
  runtimeDatabase
    .prepare(
      `
        update capture
           set text_content = ?,
               thread_title = ?
         where capture_id = ?
      `,
    )
    .run("Rewritten text", "Rewritten title", capture.captureId);
  runtimeDatabase.close();

  const thirdHead = await readInboxCaptureMutationHead(vaultRoot);
  assert.ok(thirdHead > secondHead);
  assert.deepEqual(await listInboxCaptureMutations({ vaultRoot, afterCursor: secondHead, limit: 10 }), [
    {
      captureId: capture.captureId,
      cursor: thirdHead,
    },
  ]);

  pipeline.close();
});

test("attachment parse job filters and requeue reset runtime-only parser state", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-requeue-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-requeue-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const firstPath = await writeExternalFile(sourceRoot, "first.pdf", "document-one");
  const secondPath = await writeExternalFile(sourceRoot, "second.pdf", "document-two");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const first = await pipeline.processCapture({
    source: "email",
    externalId: "requeue-first",
    thread: {
      id: "chat-requeue",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T10:30:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: firstPath,
        fileName: "first.pdf",
      },
    ],
    raw: {},
  });
  const second = await pipeline.processCapture({
    source: "email",
    externalId: "requeue-second",
    thread: {
      id: "chat-requeue",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T10:31:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: secondPath,
        fileName: "second.pdf",
      },
    ],
    raw: {},
  });

  const secondJob = runtime.claimNextAttachmentParseJob({ captureId: second.captureId });
  assert.ok(secondJob);
  assert.equal(secondJob.captureId, second.captureId);

  const firstAttachmentId = runtime.getCapture(first.captureId)?.attachments[0]?.attachmentId;
  assert.ok(firstAttachmentId);
  const firstJob = runtime.claimNextAttachmentParseJob({ attachmentId: firstAttachmentId });
  assert.ok(firstJob);
  assert.equal(firstJob.captureId, first.captureId);
  assert.equal(firstJob.attachmentId, firstAttachmentId);

  runtime.completeAttachmentParseJob({
    jobId: firstJob.jobId,
    attempt: firstJob.attempts,
    providerId: "fake-document-parser",
    resultPath: "derived/inbox/first.json",
    extractedText: "Glucose 88 mg/dL",
  });
  runtime.completeAttachmentParseJob({
    jobId: secondJob.jobId,
    attempt: secondJob.attempts,
    providerId: "fake-document-parser",
    resultPath: "derived/inbox/second.json",
    extractedText: "Unrelated text",
  });

  assert.equal(
    runtime.searchCaptures({
      text: "glucose",
      limit: 10,
    })[0]?.captureId,
    first.captureId,
  );

  const requeued = runtime.requeueAttachmentParseJobs({
    attachmentId: firstAttachmentId,
    state: "succeeded",
  });
  assert.equal(requeued, 1);

  const requeuedJob = runtime.listAttachmentParseJobs({
    captureId: first.captureId,
    limit: 10,
  })[0];
  assert.equal(requeuedJob?.state, "pending");
  assert.equal(requeuedJob?.providerId ?? null, null);
  assert.equal(requeuedJob?.resultPath ?? null, null);
  assert.equal(requeuedJob?.errorCode ?? null, null);
  assert.equal(requeuedJob?.errorMessage ?? null, null);
  assert.equal(requeuedJob?.startedAt ?? null, null);
  assert.equal(requeuedJob?.finishedAt ?? null, null);

  const refreshed = runtime.getCapture(first.captureId);
  assert.ok(refreshed);
  assert.equal(refreshed.attachments[0]?.parseState, "pending");
  assert.equal(refreshed.attachments[0]?.parserProviderId ?? null, null);
  assert.equal(refreshed.attachments[0]?.derivedPath ?? null, null);
  assert.equal(refreshed.attachments[0]?.extractedText ?? null, null);
  assert.equal(refreshed.attachments[0]?.transcriptText ?? null, null);
  assert.equal(
    runtime.searchCaptures({
      text: "glucose",
      limit: 10,
    }).length,
    0,
  );
  assert.equal(
    runtime.getCapture(second.captureId)?.attachments[0]?.parseState,
    "succeeded",
  );

  pipeline.close();
});

test("requeue can reset running attachment parse jobs back to pending", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-requeue-running-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-requeue-running-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const documentPath = await writeExternalFile(sourceRoot, "running.pdf", "document");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "email",
    externalId: "requeue-running",
    thread: {
      id: "chat-requeue-running",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T10:32:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: documentPath,
        fileName: "running.pdf",
      },
    ],
    raw: {},
  });

  const job = runtime.claimNextAttachmentParseJob({
    captureId: capture.captureId,
  });
  assert.ok(job);
  assert.equal(job.state, "running");

  assert.equal(
    runtime.requeueAttachmentParseJobs({
      captureId: capture.captureId,
      state: "running",
    }),
    1,
  );

  const requeuedJob = runtime.listAttachmentParseJobs({
    captureId: capture.captureId,
    limit: 10,
  })[0];
  assert.equal(requeuedJob?.state, "pending");
  assert.equal(requeuedJob?.providerId ?? null, null);
  assert.equal(requeuedJob?.resultPath ?? null, null);
  assert.equal(requeuedJob?.errorCode ?? null, null);
  assert.equal(requeuedJob?.errorMessage ?? null, null);
  assert.equal(requeuedJob?.startedAt ?? null, null);
  assert.equal(requeuedJob?.finishedAt ?? null, null);
  assert.equal(runtime.getCapture(capture.captureId)?.attachments[0]?.parseState, "pending");

  pipeline.close();
});

test("requeue invalidates stale running claims before finalization", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-requeue-stale-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-requeue-stale-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const documentPath = await writeExternalFile(sourceRoot, "stale.pdf", "document");
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const capture = await pipeline.processCapture({
    source: "email",
    externalId: "requeue-stale",
    thread: {
      id: "chat-requeue-stale",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T10:33:00.000Z",
    text: null,
    attachments: [
      {
        kind: "document",
        mime: "application/pdf",
        originalPath: documentPath,
        fileName: "stale.pdf",
      },
    ],
    raw: {},
  });

  const staleClaim = runtime.claimNextAttachmentParseJob({
    captureId: capture.captureId,
  });
  assert.ok(staleClaim);
  assert.equal(staleClaim.state, "running");

  assert.equal(
    runtime.requeueAttachmentParseJobs({
      captureId: capture.captureId,
      state: "running",
    }),
    1,
  );

  const staleComplete = runtime.completeAttachmentParseJob({
    jobId: staleClaim.jobId,
    attempt: staleClaim.attempts,
    providerId: "stale-provider",
    resultPath: "derived/inbox/stale.json",
    extractedText: "stale text",
  });
  assert.equal(staleComplete.applied, false);
  assert.equal(staleComplete.job.state, "pending");

  const staleFail = runtime.failAttachmentParseJob({
    jobId: staleClaim.jobId,
    attempt: staleClaim.attempts,
    errorCode: "stale",
    errorMessage: "stale claim",
  });
  assert.equal(staleFail.applied, false);
  assert.equal(staleFail.job.state, "pending");

  const freshClaim = runtime.claimNextAttachmentParseJob({
    captureId: capture.captureId,
  });
  assert.ok(freshClaim);
  assert.equal(freshClaim.attempts, staleClaim.attempts + 1);

  const freshComplete = runtime.completeAttachmentParseJob({
    jobId: freshClaim.jobId,
    attempt: freshClaim.attempts,
    providerId: "fresh-provider",
    resultPath: "derived/inbox/fresh.json",
    extractedText: "fresh text",
  });
  assert.equal(freshComplete.applied, true);
  assert.equal(freshComplete.job.state, "succeeded");
  assert.equal(runtime.getCapture(capture.captureId)?.attachments[0]?.derivedPath, "derived/inbox/fresh.json");

  pipeline.close();
});

test("runtime list and search filters stay scoped across both search branches", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-filter-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const selfCapture = await pipeline.processCapture({
    source: "email",
    externalId: "filter-email-self",
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
    source: "email",
    externalId: "filter-email-other",
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
    source: "telegram",
    externalId: "filter-telegram-self",
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
      source: "email",
      accountId: "self",
      limit: 10,
    }).map((capture) => capture.captureId),
    [selfCapture.captureId],
  );
  assert.deepEqual(
    runtime.searchCaptures({
      text: "toast",
      source: "email",
      accountId: "self",
      limit: 10,
    }).map((capture) => capture.captureId),
    [selfCapture.captureId],
  );
  assert.deepEqual(
    runtime.searchCaptures({
      text: "   ",
      source: "email",
      accountId: "self",
      limit: 10,
    }).map((capture) => capture.captureId),
    [selfCapture.captureId],
  );

  pipeline.close();
});

test("runtime decoding rejects malformed sqlite rows with clear column errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-malformed-vault");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const database = openDatabaseSync(runtime.databasePath);

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
      "email",
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
      "raw/inbox/email/self/2026/03/13/cap-malformed.json",
      "2026-03-13T10:00:00.000Z",
    );

  database.close();

  assert.throws(
    () => runtime.getCapture("cap-malformed"),
    /Expected capture.thread_is_direct to be a number/,
  );

  runtime.close();
});

test("sanitizeRawMetadata redacts the current sensitive raw-key set", () => {
  const sensitiveKeys = [
    "authorization",
    "cookie",
    "set-cookie",
    "access_token",
    "refreshToken",
    "api_key",
    "secret",
    "session",
    "session_id",
    "session-token",
    "auth_token",
    "api-token",
    "private-key",
    "client_key",
    "credential",
    "credentials",
    "password",
    "passwd",
    "id-token",
    "oauth_token",
    "bearer-token",
    "csrf_token",
    "token",
  ] as const;
  const sanitized = sanitizeRawMetadata(
    Object.fromEntries(sensitiveKeys.map((key) => [key, `${key}-value`])),
  ) as Record<string, unknown>;

  for (const key of sensitiveKeys) {
    assert.equal(sanitized[key], "<REDACTED_SECRET>");
  }
});

test("sanitizeRawMetadata keeps current near-miss raw keys unchanged", () => {
  const nearMissEntries = [
    ["api", "api-value"],
    ["client", "client-value"],
    ["private", "private-value"],
    ["tokenizer", "tokenizer-value"],
    ["keynote", "keynote-value"],
    ["cookieJar", "cookie-jar-value"],
    ["sessional", "sessional-value"],
    ["secretary", "secretary-value"],
  ] as const;
  const sanitized = sanitizeRawMetadata(Object.fromEntries(nearMissEntries)) as Record<string, unknown>;

  for (const [key, value] of nearMissEntries) {
    assert.equal(sanitized[key], value);
  }
});

function openDatabaseSync(databasePath: string): DatabaseSync {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(databasePath);
}
