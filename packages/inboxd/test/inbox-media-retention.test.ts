import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test, vi } from "vitest";

import {
  appendJsonlRecord,
  initializeVault,
  readJsonlRecords,
  validateVault,
} from "@murphai/core";
import {
  buildInboxAttachmentRetentionLedgerPath,
  createInboxPipeline,
  openInboxRuntime,
  persistCanonicalInboxCapture,
  rebuildRuntimeFromVault,
  runInboxMediaRetention,
} from "../src/index.ts";
import type { InboundCapture } from "../src/contracts/capture.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function createPngBytes(): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 24, g: 128, b: 176 },
    },
  })
    .png()
    .toBuffer();

  return new Uint8Array(bytes);
}

test("runInboxMediaRetention expires old raw inbox media and preserves descriptors", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();

  const captureId = "cap_retention_old_media";
  const protectedAttachmentId = `att_${captureId}_04`;
  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W3",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-old-media",
      accountId: "self",
      thread: {
        id: "thread-1",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      receivedAt: "2026-06-01T00:00:05.000Z",
      text: "old media",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "photo.png",
          data: imageBytes,
        },
        {
          kind: "audio",
          mime: "audio/mp4",
          fileName: "voice.m4a",
          data: Buffer.from("audio-bytes"),
        },
        {
          kind: "document",
          mime: "application/pdf",
          fileName: "record.pdf",
          data: Buffer.from("%PDF-1.7\n"),
        },
        {
          kind: "image",
          mime: "image/png",
          fileName: "pinned.png",
          data: imageBytes,
        },
      ],
      raw: {},
    },
  });
  const oldEnvelope = persisted.stored;
  const imagePath = oldEnvelope.attachments[0]?.storedPath ?? "";
  const audioPath = oldEnvelope.attachments[1]?.storedPath ?? "";
  const documentPath = oldEnvelope.attachments[2]?.storedPath ?? "";
  const protectedPath = oldEnvelope.attachments[3]?.storedPath ?? "";
  const audioAttachmentId = `att_${captureId}_02`;
  const audioAttemptDirectory = `derived/inbox/${captureId}/attachments/${audioAttachmentId}/attempts/0001`;
  const audioManifestPath = `${audioAttemptDirectory}/manifest.json`;
  const audioPlainTextPath = `${audioAttemptDirectory}/plain.txt`;
  const audioMarkdownPath = `${audioAttemptDirectory}/normalized.md`;
  const audioChunksPath = `${audioAttemptDirectory}/chunks.jsonl`;
  const audioTranscriptText = "Retained voice transcript after raw audio expiry.";
  await writeVaultFile(vaultRoot, audioPlainTextPath, `${audioTranscriptText}\n`);
  await writeVaultFile(vaultRoot, audioMarkdownPath, `${audioTranscriptText}\n`);
  await writeVaultFile(vaultRoot, audioChunksPath, "");
  await writeVaultFile(
    vaultRoot,
    audioManifestPath,
    `${JSON.stringify({
      schema: "murph.parser-manifest.v1",
      providerId: "test-parser",
      createdAt: "2026-06-01T00:01:00.000Z",
      artifact: {
        attachmentId: audioAttachmentId,
        captureId,
        fileName: "voice.m4a",
        kind: "audio",
        mime: "audio/mp4",
        storedPath: audioPath,
      },
      metadata: {},
      paths: {
        chunksPath: audioChunksPath,
        markdownPath: audioMarkdownPath,
        plainTextPath: audioPlainTextPath,
        tablesPath: null,
      },
    })}\n`,
  );

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_fresh_media",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W4",
    storedAt: "2026-07-04T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-fresh-media",
      thread: {
        id: "thread-2",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-07-04T00:00:00.000Z",
      text: "fresh media",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "fresh.png",
          data: imageBytes,
        },
      ],
      raw: {},
    },
  });
  const tampered = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_tampered_media",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W5",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-tampered-media",
      thread: {
        id: "thread-3",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "tampered media",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "tampered.png",
          data: imageBytes,
        },
      ],
      raw: {},
    },
  });
  const tamperedPath = tampered.stored.attachments[0]?.storedPath ?? "";
  assert.ok(imagePath);
  assert.ok(audioPath);
  assert.ok(documentPath);
  assert.ok(protectedPath);
  assert.ok(tamperedPath);
  await writeVaultFile(vaultRoot, tamperedPath, "mutated-image");

  const result = await runInboxMediaRetention({
    vaultRoot,
    now: "2026-07-05T00:00:00.000Z",
    protectedAttachmentIds: [protectedAttachmentId],
  });

  assert.equal(result.expiredAttachments, 2);
  assert.equal(await fileExists(vaultRoot, imagePath), false);
  assert.equal(await fileExists(vaultRoot, audioPath), false);
  assert.equal(await fileExists(vaultRoot, documentPath), true);
  assert.equal(await fileExists(vaultRoot, protectedPath), true);
  assert.equal(await fileExists(vaultRoot, tamperedPath), true);
  assert.deepEqual(
    result.records.map((record) => record.storedPath).sort(),
    [audioPath, imagePath].sort(),
  );
  assert.equal(result.records.find((record) => record.storedPath === audioPath)?.retainedDerivative?.path, audioManifestPath);

  const retentionRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: buildInboxAttachmentRetentionLedgerPath("2026-07-05T00:00:00.000Z"),
  });
  assert.equal(retentionRecords.length, 2);
  assert.equal(
    (
      await runInboxMediaRetention({
        vaultRoot,
        now: "2026-07-05T00:00:00.000Z",
        protectedAttachmentIds: [protectedAttachmentId],
      })
    ).expiredAttachments,
    0,
  );
  await writeVaultBytes(vaultRoot, audioPath, Buffer.from("audio-bytes"));
  const cleanupResult = await runInboxMediaRetention({
    vaultRoot,
    now: "2026-07-05T00:00:00.000Z",
    protectedAttachmentIds: [protectedAttachmentId],
  });
  assert.equal(cleanupResult.expiredAttachments, 0);
  assert.equal(await fileExists(vaultRoot, audioPath), false);
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ vaultRoot, runtime });
    const capture = runtime.getCapture(captureId);
    assert.ok(capture);
    assert.equal(capture.attachments[0]?.storedPath, null);
    assert.equal(capture.attachments[0]?.contentStatus, "retention_expired");
    assert.equal(capture.attachments[1]?.storedPath, null);
    assert.equal(capture.attachments[1]?.contentStatus, "retention_expired");
    assert.equal(capture.attachments[1]?.derivedPath, audioManifestPath);
    assert.equal(capture.attachments[1]?.parseState, "succeeded");
    assert.equal(capture.attachments[1]?.parserProviderId, "test-parser");
    assert.equal(capture.attachments[1]?.transcriptText, audioTranscriptText);
    assert.equal(capture.attachments[1]?.extractedText, null);
    assert.equal(capture.attachments[2]?.storedPath, documentPath);
    assert.equal(capture.attachments[2]?.contentStatus, "available");
    assert.equal(capture.attachments[3]?.storedPath, protectedPath);
    assert.equal(capture.attachments[3]?.contentStatus, "available");
    assert.equal(runtime.searchCaptures({ limit: 10, text: "transcript" }).length, 1);
  } finally {
    runtime.close();
  }
});

test("runInboxMediaRetention applies the cutoff and exact path protections", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-cutoff");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();
  const now = "2026-07-05T00:00:00.000Z";

  const fresh = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_cutoff_fresh",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W6",
    storedAt: "2026-06-21T00:00:00.001Z",
    input: {
      source: "telegram",
      externalId: "msg-cutoff-fresh",
      thread: {
        id: "thread-cutoff-fresh",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-21T00:00:00.001Z",
      text: "just inside retention window",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "fresh.png",
          data: imageBytes,
        },
      ],
      raw: {},
    },
  });
  const old = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_cutoff_old",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W7",
    storedAt: "2026-06-20T23:59:59.999Z",
    input: {
      source: "telegram",
      externalId: "msg-cutoff-old",
      thread: {
        id: "thread-cutoff-old",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-20T23:59:59.999Z",
      text: "outside retention window",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "durable-ref.png",
          data: imageBytes,
        },
        {
          kind: "image",
          mime: "image/png",
          fileName: "protected-path.png",
          data: imageBytes,
        },
        {
          kind: "image",
          mime: "image/png",
          fileName: "same-bytes-duplicate.png",
          data: imageBytes,
        },
        {
          kind: "image",
          mime: "image/png",
          fileName: "evidence-only.png",
          data: imageBytes,
        },
      ],
      raw: {},
    },
  });
  const freshPath = fresh.stored.attachments[0]?.storedPath ?? "";
  const durablePath = old.stored.attachments[0]?.storedPath ?? "";
  const protectedPath = old.stored.attachments[1]?.storedPath ?? "";
  const duplicatePath = old.stored.attachments[2]?.storedPath ?? "";
  const evidencePath = old.stored.attachments[3]?.storedPath ?? "";
  assert.ok(freshPath);
  assert.ok(durablePath);
  assert.ok(protectedPath);
  assert.ok(duplicatePath);
  assert.ok(evidencePath);

  await appendJsonlRecord({
    vaultRoot,
    relativePath: "ledger/events/2026/2026-07.jsonl",
    record: {
      schemaVersion: "murph.event.v1",
      id: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W8",
      kind: "note",
      occurredAt: now,
      recordedAt: now,
      dayKey: "2026-07-05",
      source: "manual",
      title: "Promoted inbox media",
      note: "Durable event keeps one exact raw path.",
      rawRefs: [durablePath],
      evidence: [
        {
          rawRef: evidencePath,
          sourceLabel: "Inbox evidence",
        },
      ],
      media: [
        {
          relativePath: durablePath,
          sensitivity: "member-private",
        },
      ],
    },
  });

  const result = await runInboxMediaRetention({
    vaultRoot,
    now,
    protectedStoredPaths: [protectedPath],
  });

  assert.equal(result.expiredAttachments, 1);
  assert.equal(result.hasMoreEligibleAttachments, false);
  assert.equal(result.nextEligibleAt, "2026-07-05T00:00:00.001Z");
  assert.deepEqual(result.records.map((record) => record.storedPath), [duplicatePath]);
  assert.equal(await fileExists(vaultRoot, freshPath), true);
  assert.equal(await fileExists(vaultRoot, durablePath), true);
  assert.equal(await fileExists(vaultRoot, evidencePath), true);
  assert.equal(await fileExists(vaultRoot, protectedPath), true);
  assert.equal(await fileExists(vaultRoot, duplicatePath), false);
});

test("runInboxMediaRetention materializes bounded missing candidates before hashing", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-materialize");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_lazy_media",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WA",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-lazy-media",
      thread: {
        id: "thread-lazy",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "lazy old media",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "lazy.png",
          data: imageBytes,
        },
      ],
      raw: {},
    },
  });
  const imagePath = persisted.stored.attachments[0]?.storedPath ?? "";
  assert.ok(imagePath);
  const storedImageBytes = await fs.readFile(path.join(vaultRoot, imagePath));
  await fs.unlink(path.join(vaultRoot, imagePath));

  const materializedPaths: string[][] = [];
  const result = await runInboxMediaRetention({
    materializeCandidatePaths: async (storedPaths) => {
      materializedPaths.push([...storedPaths]);
      assert.deepEqual([...storedPaths], [imagePath]);
      await writeVaultBytes(vaultRoot, imagePath, storedImageBytes);
    },
    now: "2026-07-05T00:00:00.000Z",
    vaultRoot,
  });

  assert.deepEqual(materializedPaths, [[imagePath]]);
  assert.equal(result.expiredAttachments, 1);
  assert.equal(result.records[0]?.storedPath, imagePath);
  assert.equal(await fileExists(vaultRoot, imagePath), false);
  assert.equal((await validateVault({ vaultRoot })).valid, true);
});

test.skipIf(process.platform === "win32")(
  "runInboxMediaRetention does not follow symlinked raw media ancestors",
  async () => {
    const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-symlink");
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
    const imageBytes = await createPngBytes();

    const persisted = await persistCanonicalInboxCapture({
      vaultRoot,
      captureId: "cap_retention_symlink_media",
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WC",
      storedAt: "2026-06-01T00:00:00.000Z",
      input: buildOldImageCaptureInput({
        externalId: "msg-symlink-media",
        imageBytes,
        text: "symlink old media",
        threadId: "thread-symlink",
      }),
    });
    const imagePath = persisted.stored.attachments[0]?.storedPath ?? "";
    assert.ok(imagePath);
    const storedImageBytes = await fs.readFile(path.join(vaultRoot, imagePath));
    const attachmentDirectory = path.dirname(path.join(vaultRoot, imagePath));
    const attachmentFileName = path.basename(imagePath);
    const externalDirectory = await makeTempDirectory("murph-inbox-media-retention-external");
    const externalPath = path.join(externalDirectory, attachmentFileName);
    await fs.writeFile(externalPath, storedImageBytes);
    await fs.rm(attachmentDirectory, { recursive: true, force: true });
    await fs.symlink(externalDirectory, attachmentDirectory, "dir");

    const result = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });

    assert.equal(result.expiredAttachments, 0);
    assert.equal(result.records.length, 0);
    assert.equal(await fileExists(externalDirectory, attachmentFileName), true);
  },
);

test("runInboxMediaRetention honors the per-pass attachment limit", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-limit");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_limit",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W9",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-limit-media",
      thread: {
        id: "thread-limit",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "old media",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "first.png",
          data: imageBytes,
        },
        {
          kind: "audio",
          mime: "audio/mp4",
          fileName: "second.m4a",
          data: Buffer.from("audio-bytes"),
        },
      ],
      raw: {},
    },
  });
  const firstPath = persisted.stored.attachments[0]?.storedPath ?? "";
  const secondPath = persisted.stored.attachments[1]?.storedPath ?? "";
  assert.ok(firstPath);
  assert.ok(secondPath);

  const firstPass = await runInboxMediaRetention({
    maxAttachments: 1,
    now: "2026-07-05T00:00:00.000Z",
    vaultRoot,
  });
  assert.equal(firstPass.expiredAttachments, 1);
  assert.equal(firstPass.hasMoreEligibleAttachments, true);
  assert.equal(firstPass.nextEligibleAt, null);
  assert.equal(await fileExists(vaultRoot, firstPath), false);
  assert.equal(await fileExists(vaultRoot, secondPath), true);

  const secondPass = await runInboxMediaRetention({
    maxAttachments: 1,
    now: "2026-07-05T00:00:00.000Z",
    vaultRoot,
  });
  assert.equal(secondPass.expiredAttachments, 1);
  assert.equal(secondPass.hasMoreEligibleAttachments, false);
  assert.equal(secondPass.nextEligibleAt, null);
  assert.equal(await fileExists(vaultRoot, secondPath), false);
});

test("runInboxMediaRetention skips missing already-tombstoned media before batch admission", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-tombstoned-missing");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();
  const now = "2026-07-05T00:00:00.000Z";

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_tombstoned_missing_1",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WD",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: buildOldImageCaptureInput({
      externalId: "msg-tombstoned-missing-1",
      imageBytes,
      text: "first tombstoned media",
      threadId: "thread-tombstoned-missing",
    }),
  });
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_tombstoned_missing_2",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WE",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: buildOldImageCaptureInput({
      externalId: "msg-tombstoned-missing-2",
      imageBytes,
      text: "second tombstoned media",
      threadId: "thread-tombstoned-missing",
    }),
  });
  const initial = await runInboxMediaRetention({
    maxAttachments: 2,
    now,
    vaultRoot,
  });
  assert.equal(initial.expiredAttachments, 2);

  const later = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_tombstoned_missing_3",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WF",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: buildOldImageCaptureInput({
      externalId: "msg-tombstoned-missing-3",
      imageBytes,
      text: "later media should still be reached",
      threadId: "thread-tombstoned-missing",
    }),
  });
  const laterPath = later.stored.attachments[0]?.storedPath ?? "";
  assert.ok(laterPath);
  const materializedPaths: string[][] = [];

  const result = await runInboxMediaRetention({
    materializeCandidatePaths: async (storedPaths) => {
      materializedPaths.push([...storedPaths]);
    },
    maxAttachments: 2,
    now,
    vaultRoot,
  });

  assert.deepEqual(materializedPaths, []);
  assert.equal(result.expiredAttachments, 1);
  assert.equal(result.hasMoreEligibleAttachments, false);
  assert.equal(result.records[0]?.storedPath, laterPath);
  assert.equal(await fileExists(vaultRoot, laterPath), false);
});

test("runInboxMediaRetention finishes deleting committed tombstones after wake aborts", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-delete-abort");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_delete_abort",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WB",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-delete-abort",
      thread: {
        id: "thread-delete-abort",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "delete abort media",
      attachments: [
        {
          kind: "image",
          mime: "image/png",
          fileName: "first.png",
          data: imageBytes,
        },
        {
          kind: "image",
          mime: "image/png",
          fileName: "second.png",
          data: imageBytes,
        },
      ],
      raw: {},
    },
  });
  const firstPath = persisted.stored.attachments[0]?.storedPath ?? "";
  const secondPath = persisted.stored.attachments[1]?.storedPath ?? "";
  assert.ok(firstPath);
  assert.ok(secondPath);

  const controller = new AbortController();
  const originalUnlink = fs.unlink.bind(fs);
  let unlinkCount = 0;
  const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(async (...args) => {
    unlinkCount += 1;
    if (unlinkCount === 1) {
      controller.abort(new Error("foreground wake"));
    }
    await originalUnlink(...args);
  });

  try {
    const result = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      signal: controller.signal,
      vaultRoot,
    });

    assert.equal(controller.signal.aborted, true);
    assert.equal(result.expiredAttachments, 2);
    assert.equal(unlinkCount, 2);
    assert.equal(await fileExists(vaultRoot, firstPath), false);
    assert.equal(await fileExists(vaultRoot, secondPath), false);
    assert.equal((await validateVault({ vaultRoot })).valid, true);
  } finally {
    unlinkSpy.mockRestore();
  }
});

test("processCapture preserves retention-expired attachment state on dedupe replay", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-dedupe");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();
  const inbound = buildOldImageCaptureInput({
    externalId: "msg-retention-dedupe",
    imageBytes,
    text: "dedupe replay after retention",
    threadId: "thread-retention-dedupe",
  });
  const runtime = await openInboxRuntime({ vaultRoot });

  try {
    const persisted = await persistCanonicalInboxCapture({
      vaultRoot,
      captureId: "cap_retention_dedupe",
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2WG",
      storedAt: "2026-06-01T00:00:00.000Z",
      input: inbound,
    });
    const imagePath = persisted.stored.attachments[0]?.storedPath ?? "";
    assert.ok(imagePath);
    const result = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });
    assert.equal(result.expiredAttachments, 1);
    await rebuildRuntimeFromVault({ vaultRoot, runtime });
    assert.equal(runtime.getCapture(persisted.stored.captureId)?.attachments[0]?.storedPath, null);
    assert.equal(
      runtime.getCapture(persisted.stored.captureId)?.attachments[0]?.contentStatus,
      "retention_expired",
    );

    const pipeline = await createInboxPipeline({ vaultRoot, runtime });
    const replayed = await pipeline.processCapture(inbound);

    assert.equal(replayed.deduped, true);
    assert.equal(runtime.getCapture(persisted.stored.captureId)?.attachments[0]?.storedPath, null);
    assert.equal(
      runtime.getCapture(persisted.stored.captureId)?.attachments[0]?.contentStatus,
      "retention_expired",
    );
  } finally {
    runtime.close();
  }
});

function buildOldImageCaptureInput(input: {
  externalId: string;
  imageBytes: Uint8Array;
  text: string;
  threadId: string;
}): InboundCapture {
  return {
    source: "telegram",
    externalId: input.externalId,
    thread: {
      id: input.threadId,
      isDirect: true,
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-06-01T00:00:00.000Z",
    text: input.text,
    attachments: [
      {
        kind: "image",
        mime: "image/png",
        fileName: "photo.png",
        data: input.imageBytes,
      },
    ],
    raw: {},
  };
}

async function writeVaultFile(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}

async function writeVaultBytes(vaultRoot: string, relativePath: string, content: Uint8Array): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content);
}

async function fileExists(vaultRoot: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}
