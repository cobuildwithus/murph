import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { initializeVault } from "@murphai/core";

import type {
  InboundCapture,
  StoredAttachment,
  StoredCapture,
} from "../src/contracts/capture.ts";
import * as indexSurface from "../src/index.ts";
import {
  buildInboxCaptureLedgerPath,
  buildInboxCaptureLedgerPathForOccurredAt,
  prepareInboxCaptureRecord,
} from "../src/indexing/persist/canonical-records.ts";
import * as runtimeSurface from "../src/runtime.ts";
import { buildAttachmentId } from "../src/shared.ts";

test("runtime and package barrels expose the same inbox runtime seam", async () => {
  assert.equal(runtimeSurface.openInboxRuntime, indexSurface.openInboxRuntime);
  assert.equal(runtimeSurface.createInboxPipeline, indexSurface.createInboxPipeline);
  assert.equal(runtimeSurface.listInboxCaptureMutations, indexSurface.listInboxCaptureMutations);
  assert.equal(runtimeSurface.readInboxCaptureMutationHead, indexSurface.readInboxCaptureMutationHead);
  assert.equal(runtimeSurface.rebuildRuntimeFromVault, indexSurface.rebuildRuntimeFromVault);

  const vaultRoot = await makeTempDirectory("murph-inbox-runtime-barrel");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await runtimeSurface.openInboxRuntime({ vaultRoot });
  try {
    assert.equal(await runtimeSurface.readInboxCaptureMutationHead(vaultRoot), 0);
    assert.deepEqual(
      await runtimeSurface.listInboxCaptureMutations({
        vaultRoot,
        afterCursor: 0,
        limit: 10,
      }),
      [],
    );
  } finally {
    runtime.close();
  }
});

test("sqlite runtime mutation head follows the latest capture state and created-at paging surfaces later inserts that share an occurredAt", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-runtime-mutations");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await runtimeSurface.openInboxRuntime({ vaultRoot });
  try {
    const occurredAt = "2026-03-13T08:00:00.000Z";
    const alpha = createIndexedCaptureFixture({
      captureId: "cap-alpha",
      source: "telegram",
      accountId: "bot",
      externalId: "update:1",
      occurredAt,
      text: "alpha",
      attachments: [
        {
          attachmentId: buildAttachmentId("cap-alpha", 1),
          ordinal: 1,
          kind: "document",
          mime: "application/pdf",
          fileName: "alpha.pdf",
          storedPath: "raw/inbox/telegram/bot/alpha.pdf",
          sha256: "alpha-sha",
          byteSize: 11,
        },
      ],
    });
    const beta = createIndexedCaptureFixture({
      captureId: "cap-beta",
      source: "telegram",
      accountId: "bot",
      externalId: "update:2",
      occurredAt,
      text: "beta",
    });

    runtime.upsertCaptureIndex(alpha);
    const firstHead = await runtimeSurface.readInboxCaptureMutationHead(vaultRoot);
    assert.ok(firstHead > 0);

    runtime.upsertCaptureIndex(beta);
    const secondHead = await runtimeSurface.readInboxCaptureMutationHead(vaultRoot);
    assert.ok(secondHead > firstHead);

    assert.deepEqual(
      await runtimeSurface.listInboxCaptureMutations({
        vaultRoot,
        afterCursor: 0,
        limit: 10,
      }),
      [
        { captureId: "cap-alpha", cursor: firstHead },
        { captureId: "cap-beta", cursor: secondHead },
      ],
    );

    assert.deepEqual(
      runtime.listCaptures({
        source: "telegram",
        accountId: "bot",
        oldestFirst: true,
        limit: 5,
      }).map((capture) => capture.captureId),
      ["cap-alpha", "cap-beta"],
    );
    assert.deepEqual(
      runtime.listCaptures({
        source: "telegram",
        accountId: "bot",
        oldestFirst: true,
        afterOccurredAt: occurredAt,
        afterCaptureId: "cap-alpha",
        limit: 5,
      }).map((capture) => capture.captureId),
      ["cap-beta"],
    );
    assert.deepEqual(
      runtime.listCaptures({
        source: "telegram",
        accountId: "bot",
        oldestFirst: true,
        afterCreatedAt: alpha.stored.storedAt,
        afterCaptureId: "cap-alpha",
        limit: 5,
      }).map((capture) => capture.captureId),
      ["cap-beta"],
    );

    runtime.upsertCaptureIndex({
      ...alpha,
      input: {
        ...alpha.input,
        text: "alpha rewritten",
      },
      stored: {
        ...alpha.stored,
        storedAt: "2026-03-13T08:00:03.000Z",
        attachments: [],
      },
    });
    const rewrittenHead = await runtimeSurface.readInboxCaptureMutationHead(vaultRoot);
    assert.ok(rewrittenHead > secondHead);

    assert.deepEqual(
      await runtimeSurface.listInboxCaptureMutations({
        vaultRoot,
        afterCursor: secondHead,
        limit: 10,
      }),
      [{ captureId: "cap-alpha", cursor: rewrittenHead }],
    );

    const rewritten = runtime.getCapture("cap-alpha");
    assert.ok(rewritten);
    assert.equal(rewritten.text, "alpha rewritten");
    assert.deepEqual(rewritten.attachments, []);
  } finally {
    runtime.close();
  }
});

test("sqlite runtime resolves attachments by id without capture-list scanning", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-runtime-attachment-lookup");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await runtimeSurface.openInboxRuntime({ vaultRoot });
  try {
    const attachmentId = buildAttachmentId("cap-attachment-owner", 1);
    runtime.upsertCaptureIndex(createIndexedCaptureFixture({
      captureId: "cap-attachment-owner",
      source: "telegram",
      accountId: "bot",
      externalId: "update:attachment-owner",
      occurredAt: "2026-03-13T08:00:00.000Z",
      text: "capture with attachment",
      attachments: [
        {
          attachmentId,
          ordinal: 1,
          kind: "document",
          mime: "application/pdf",
          fileName: "report.pdf",
          storedPath: "raw/inbox/telegram/bot/report.pdf",
          sha256: "report-sha",
          byteSize: 12,
        },
      ],
    }));

    const match = runtime.getAttachment(attachmentId);
    assert.equal(match?.capture.captureId, "cap-attachment-owner");
    assert.equal(match?.attachment.fileName, "report.pdf");
    assert.equal(runtime.getAttachment("missing-attachment"), null);
  } finally {
    runtime.close();
  }
});

test("canonical inbox record builders sanitize attachment paths and keep raw refs sparse", () => {
  const inbound = createInboundCaptureFixture({
    source: "telegram",
    accountId: "bot",
    externalId: "update-77",
    occurredAt: "2026-03-13T09:00:00.000Z",
    text: "Short canonical note",
  });
  const stored = createStoredCaptureFixture({
    captureId: "cap-canonical",
    source: "telegram",
    externalId: "update-77",
    storedAt: "2026-03-13T09:00:05.000Z",
    attachments: [
      {
        attachmentId: "att_cap-canonical_01",
        ordinal: 1,
        kind: "document",
        mime: "application/pdf",
        fileName: "lab.pdf",
        storedPath: "raw/inbox/telegram/bot/lab.pdf",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        byteSize: 123,
      },
      {
        attachmentId: "att_cap-canonical_02",
        ordinal: 2,
        kind: "image",
        fileName: "photo.jpg",
      },
    ],
  });

  const captureRecord = prepareInboxCaptureRecord({
    eventId: stored.eventId,
    inbound,
    stored,
  }).record;

  assert.equal("auditId" in captureRecord, false);
  assert.deepEqual(captureRecord.rawRefs, ["raw/inbox/telegram/bot/lab.pdf"]);
  assert.equal(captureRecord.attachments[0]?.originalPath, null);
  assert.equal(captureRecord.attachments[0]?.storedPath, "raw/inbox/telegram/bot/lab.pdf");
  assert.equal(captureRecord.attachments[1]?.storedPath ?? null, null);
  assert.equal(
    buildInboxCaptureLedgerPathForOccurredAt(inbound.occurredAt),
    "ledger/inbox-captures/2026/2026-03.jsonl",
  );
  assert.equal(
    buildInboxCaptureLedgerPath({ input: inbound }),
    "ledger/inbox-captures/2026/2026-03.jsonl",
  );
});

test("sqlite runtime replay replaces stale external-id rows with the canonical captureId and ignores unchanged replays", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-runtime-replay-identity");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await runtimeSurface.openInboxRuntime({ vaultRoot });
  try {
    const stale = createIndexedCaptureFixture({
      captureId: "cap-stale",
      source: "telegram",
      accountId: "bot",
      externalId: "update:collision",
      occurredAt: "2026-03-13T09:00:00.000Z",
      text: "stale runtime row",
      attachments: [
        {
          attachmentId: buildAttachmentId("cap-stale", 1),
          ordinal: 1,
          kind: "document",
          mime: "application/pdf",
          fileName: "stale.pdf",
          storedPath: "raw/inbox/telegram/bot/stale.pdf",
          sha256: "stale-sha",
          byteSize: 5,
        },
      ],
    });
    const canonical = createIndexedCaptureFixture({
      captureId: "cap-canonical",
      source: "telegram",
      accountId: "bot",
      externalId: "update:collision",
      occurredAt: "2026-03-13T09:00:00.000Z",
      text: "canonical replay row",
      attachments: [
        {
          attachmentId: buildAttachmentId("cap-canonical", 1),
          ordinal: 1,
          kind: "document",
          mime: "application/pdf",
          fileName: "canonical.pdf",
          storedPath: "raw/inbox/telegram/bot/canonical.pdf",
          sha256: "canonical-sha",
          byteSize: 9,
        },
      ],
    });

    runtime.upsertCaptureIndex(stale);
    const staleHead = await runtimeSurface.readInboxCaptureMutationHead(vaultRoot);
    assert.ok(staleHead > 0);
    assert.equal(runtime.findByExternalId("telegram", "bot", "update:collision")?.captureId, "cap-stale");

    runtime.upsertCaptureIndex(canonical);
    const repairedHead = await runtimeSurface.readInboxCaptureMutationHead(vaultRoot);
    assert.ok(repairedHead > staleHead);
    assert.equal(runtime.getCapture("cap-stale"), null);

    const repaired = runtime.getCapture("cap-canonical");
    assert.ok(repaired);
    assert.equal(repaired.captureId, "cap-canonical");
    assert.equal(repaired.text, "canonical replay row");
    assert.deepEqual(
      repaired.attachments.map((attachment) => attachment.attachmentId),
      [buildAttachmentId("cap-canonical", 1)],
    );
    assert.equal(
      runtime.findByExternalId("telegram", "bot", "update:collision")?.captureId,
      "cap-canonical",
    );
    assert.deepEqual(
      runtime.listCaptures({
        source: "telegram",
        accountId: "bot",
        limit: 10,
      }).map((capture) => capture.captureId),
      ["cap-canonical"],
    );

    runtime.upsertCaptureIndex(canonical);
    const noOpHead = await runtimeSurface.readInboxCaptureMutationHead(vaultRoot);
    assert.equal(noOpHead, repairedHead);
    assert.deepEqual(
      await runtimeSurface.listInboxCaptureMutations({
        vaultRoot,
        afterCursor: repairedHead,
        limit: 10,
      }),
      [],
    );
  } finally {
    runtime.close();
  }
});

test("sqlite runtime rejects attachment ids that do not belong to the chosen capture id", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-runtime-attachment-identity");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await runtimeSurface.openInboxRuntime({ vaultRoot });
  try {
    const capture = createIndexedCaptureFixture({
      captureId: "cap-owning",
      source: "telegram",
      accountId: "bot",
      externalId: "update:bad-attachment-id",
      occurredAt: "2026-03-13T09:30:00.000Z",
      text: "bad attachment id",
      attachments: [
        {
          attachmentId: buildAttachmentId("cap-other", 1),
          ordinal: 1,
          kind: "document",
          mime: "application/pdf",
          fileName: "bad.pdf",
          storedPath: "raw/inbox/telegram/bot/bad.pdf",
          sha256: "bad-sha",
          byteSize: 7,
        },
      ],
    });

    assert.throws(
      () => runtime.upsertCaptureIndex(capture),
      /Inbox runtime requires attachment ids derived from capture "cap-owning"/,
    );
  } finally {
    runtime.close();
  }
});

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function createInboundCaptureFixture(input: {
  source: string;
  externalId: string;
  occurredAt: string;
  accountId?: string | null;
  text: string | null;
  attachments?: InboundCapture["attachments"];
}): InboundCapture {
  return {
    source: input.source,
    externalId: input.externalId,
    accountId: input.accountId ?? null,
    thread: {
      id: "thread-1",
      title: "Thread",
      isDirect: false,
    },
    actor: {
      id: "actor-1",
      displayName: "Actor",
      isSelf: false,
    },
    occurredAt: input.occurredAt,
    receivedAt: null,
    text: input.text,
    attachments: input.attachments ?? [],
    raw: {
      nestedPath: "/Users/<REDACTED_USER>/Documents/inbox.json",
      access_token: "secret-token",
    },
  };
}

function createStoredCaptureFixture(input: {
  captureId: string;
  source: string;
  externalId: string;
  storedAt: string;
  attachments?: StoredAttachment[];
}): StoredCapture {
  return {
    captureId: input.captureId,
    eventId: "evt_01JQKZ7PQ6J0M7Q5A2V9W4X6YZ",
    storedAt: input.storedAt,
    sourceDirectory: `raw/inbox/${input.source}/${input.externalId}`,
    attachments: input.attachments ?? [],
  };
}

function createIndexedCaptureFixture(input: {
  captureId: string;
  source: string;
  accountId?: string | null;
  externalId: string;
  occurredAt: string;
  text: string | null;
  attachments?: StoredAttachment[];
}): {
  captureId: string;
  eventId: string;
  input: InboundCapture;
  stored: StoredCapture;
} {
  const inbound = createInboundCaptureFixture({
    source: input.source,
    accountId: input.accountId ?? null,
    externalId: input.externalId,
    occurredAt: input.occurredAt,
    text: input.text,
  });
  const stored = createStoredCaptureFixture({
    captureId: input.captureId,
    source: input.source,
    externalId: input.externalId,
    storedAt: "2026-03-13T08:00:01.000Z",
    attachments: input.attachments ?? [],
  });

  return {
    captureId: input.captureId,
    eventId: stored.eventId,
    input: inbound,
    stored,
  };
}
