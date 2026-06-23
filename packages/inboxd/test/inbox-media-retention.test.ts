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
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
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

test("runInboxMediaRetention protects every attachment in an active pending capture", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-protected-capture");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();
  const captureId = "cap_retention_protected_capture";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VH",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-protected-capture",
      thread: {
        id: "thread-protected-capture",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "protected capture media",
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
      ],
      raw: {},
    },
  });
  const imagePath = persisted.stored.attachments[0]?.storedPath ?? "";
  const audioPath = persisted.stored.attachments[1]?.storedPath ?? "";
  assert.ok(imagePath);
  assert.ok(audioPath);

  const result = await runInboxMediaRetention({
    now: "2026-07-05T00:00:00.000Z",
    protectedCaptureIds: [captureId],
    vaultRoot,
  });

  assert.equal(result.expiredAttachments, 0);
  assert.equal(result.records.length, 0);
  assert.equal(await fileExists(vaultRoot, imagePath), true);
  assert.equal(await fileExists(vaultRoot, audioPath), true);
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

test("runInboxMediaRetention protects audio while its parser job is fresh and nonterminal", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-parser-job");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const captureId = "cap_retention_parser_job";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VH",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-parser-job-media",
      thread: {
        id: "thread-parser-job",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "old audio waiting for parser",
      attachments: [
        {
          kind: "audio",
          mime: "audio/mp4",
          fileName: "voice.m4a",
          data: Buffer.from("audio-bytes"),
        },
      ],
      raw: {},
    },
  });
  const audioPath = persisted.stored.attachments[0]?.storedPath ?? "";
  assert.ok(audioPath);

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
    runtime.enqueueDerivedJobs({
      captureId,
      stored: persisted.stored,
    });
    const pendingJob = runtime.listAttachmentParseJobs({ captureId, limit: 10 })[0];
    assert.ok(pendingJob);
    assert.equal(pendingJob.state, "pending");
    await updateAttachmentParseJobTimes({
      createdAt: "2026-07-04T00:00:00.000Z",
      databasePath: runtime.databasePath,
      jobId: pendingJob.jobId,
      startedAt: null,
    });

    const protectedResult = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });
    assert.equal(protectedResult.expiredAttachments, 0);
    assert.equal(await fileExists(vaultRoot, audioPath), true);

    await updateAttachmentParseJobTimes({
      createdAt: "2026-06-01T00:00:00.000Z",
      databasePath: runtime.databasePath,
      jobId: pendingJob.jobId,
      startedAt: null,
    });

    const expiredResult = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });
    assert.equal(expiredResult.expiredAttachments, 1);
    assert.equal(await fileExists(vaultRoot, audioPath), false);
  } finally {
    runtime.close();
  }
});

test("runInboxMediaRetention protects audio while its running parser job is fresh", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-running-parser-job");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const captureId = "cap_retention_running_parser_job";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VN",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-running-parser-job-media",
      thread: {
        id: "thread-running-parser-job",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "old audio with running parser work",
      attachments: [
        {
          kind: "audio",
          mime: "audio/mp4",
          fileName: "voice.m4a",
          data: Buffer.from("audio-bytes"),
        },
      ],
      raw: {},
    },
  });
  const audioPath = persisted.stored.attachments[0]?.storedPath ?? "";
  assert.ok(audioPath);

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
    runtime.enqueueDerivedJobs({
      captureId,
      stored: persisted.stored,
    });
    const pendingJob = runtime.listAttachmentParseJobs({ captureId, limit: 10 })[0];
    assert.ok(pendingJob);
    const runningJob = runtime.claimNextAttachmentParseJob({
      captureId,
    });
    assert.ok(runningJob);
    assert.equal(runningJob.state, "running");
    await updateAttachmentParseJobTimes({
      createdAt: "2026-06-01T00:00:00.000Z",
      databasePath: runtime.databasePath,
      jobId: runningJob.jobId,
      startedAt: "2026-07-04T00:00:00.000Z",
    });

    const protectedResult = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });
    assert.equal(protectedResult.expiredAttachments, 0);
    assert.equal(await fileExists(vaultRoot, audioPath), true);

    await updateAttachmentParseJobTimes({
      createdAt: "2026-06-01T00:00:00.000Z",
      databasePath: runtime.databasePath,
      jobId: runningJob.jobId,
      startedAt: "2026-06-01T00:00:00.000Z",
    });

    const expiredResult = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });
    assert.equal(expiredResult.expiredAttachments, 1);
    assert.equal(expiredResult.records[0]?.attachmentId, pendingJob.attachmentId);
    assert.equal(await fileExists(vaultRoot, audioPath), false);
  } finally {
    runtime.close();
  }
});

test("runInboxMediaRetention ignores stale and unclaimable legacy parser rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-legacy-parser-row");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();
  const captureId = "cap_retention_legacy_parser_row";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VJ",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: buildOldImageCaptureInput({
      externalId: "msg-legacy-parser-row",
      imageBytes,
      text: "old image with legacy parser row",
      threadId: "thread-legacy-parser-row",
    }),
  });
  const imageAttachment = persisted.stored.attachments[0];
  assert.ok(imageAttachment);
  const imagePath = imageAttachment.storedPath ?? "";
  assert.ok(imagePath);

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
    await insertLegacyAttachmentParseJob({
      attachmentId: imageAttachment.attachmentId,
      captureId,
      createdAt: "2026-07-04T00:00:00.000Z",
      databasePath: runtime.databasePath,
      jobId: "job_legacy_image_parser_row",
      state: "pending",
    });

    const result = await runInboxMediaRetention({
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });
    assert.equal(result.expiredAttachments, 1);
    assert.equal(result.records[0]?.attachmentId, imageAttachment.attachmentId);
    assert.equal(await fileExists(vaultRoot, imagePath), false);
  } finally {
    runtime.close();
  }
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

test("runInboxMediaRetention checks the batch limit before hashing another eligible attachment", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-limit-before-hash");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_limit_before_hash",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VW",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-limit-before-hash",
      thread: {
        id: "thread-limit-before-hash",
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

  const lstatPaths: string[] = [];
  const originalLstat = fs.lstat.bind(fs);
  const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
    if (typeof args[0] === "string") {
      lstatPaths.push(args[0]);
    }
    return await originalLstat(...args);
  });

  try {
    const result = await runInboxMediaRetention({
      maxAttachments: 1,
      now: "2026-07-05T00:00:00.000Z",
      vaultRoot,
    });

    assert.equal(result.expiredAttachments, 1);
    assert.equal(result.hasMoreEligibleAttachments, true);
    assert.ok(lstatPaths.includes(path.join(vaultRoot, firstPath)));
    assert.equal(lstatPaths.includes(path.join(vaultRoot, secondPath)), false);
    assert.equal(await fileExists(vaultRoot, firstPath), false);
    assert.equal(await fileExists(vaultRoot, secondPath), true);
  } finally {
    lstatSpy.mockRestore();
  }
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

test("runInboxMediaRetention does not let unmaterializable media consume the batch", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-missing-materialize");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();
  const now = "2026-07-05T00:00:00.000Z";

  const first = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_missing_materialize_1",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VM",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: buildOldImageCaptureInput({
      externalId: "msg-missing-materialize-1",
      imageBytes,
      text: "first missing media",
      threadId: "thread-missing-materialize",
    }),
  });
  const second = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_retention_missing_materialize_2",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VK",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: buildOldImageCaptureInput({
      externalId: "msg-missing-materialize-2",
      imageBytes,
      text: "second present media",
      threadId: "thread-missing-materialize",
    }),
  });
  const missingPath = first.stored.attachments[0]?.storedPath ?? "";
  const presentPath = second.stored.attachments[0]?.storedPath ?? "";
  assert.ok(missingPath);
  assert.ok(presentPath);
  await fs.unlink(path.join(vaultRoot, missingPath));

  const materializedPaths: string[][] = [];
  const result = await runInboxMediaRetention({
    materializeCandidatePaths: async (storedPaths) => {
      materializedPaths.push([...storedPaths]);
      return { missingStoredPaths: storedPaths };
    },
    maxAttachments: 1,
    now,
    vaultRoot,
  });

  assert.deepEqual(materializedPaths, [[missingPath]]);
  assert.equal(result.expiredAttachments, 2);
  assert.equal(result.hasMoreEligibleAttachments, false);
  assert.deepEqual(result.records.map((record) => record.storedPath), [
    missingPath,
    presentPath,
  ]);
  assert.equal(await fileExists(vaultRoot, missingPath), false);
  assert.equal(await fileExists(vaultRoot, presentPath), false);
});

test("runInboxMediaRetention bounds missing legacy materialization and tombstones misses", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-materialize-limit");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const imageBytes = await createPngBytes();
  const paths: string[] = [];

  for (const index of [1, 2, 3]) {
    const persisted = await persistCanonicalInboxCapture({
      vaultRoot,
      captureId: `cap_retention_materialize_limit_${index}`,
      eventId: `evt_01HQW7K0M9N8P7Q6R5S4T3V2V${index}`,
      storedAt: "2026-06-01T00:00:00.000Z",
      input: buildOldImageCaptureInput({
        externalId: `msg-materialize-limit-${index}`,
        imageBytes,
        text: `missing legacy media ${index}`,
        threadId: "thread-materialize-limit",
      }),
    });
    const storedPath = persisted.stored.attachments[0]?.storedPath ?? "";
    assert.ok(storedPath);
    await fs.unlink(path.join(vaultRoot, storedPath));
    paths.push(storedPath);
  }

  const materializedPaths: string[][] = [];
  const runOnce = () => runInboxMediaRetention({
    materializeCandidatePaths: async (storedPaths) => {
      materializedPaths.push([...storedPaths]);
      return { missingStoredPaths: storedPaths };
    },
    maxAttachments: 1,
    now: "2026-07-05T00:00:00.000Z",
    vaultRoot,
  });

  const firstPass = await runOnce();
  assert.deepEqual(materializedPaths, [[paths[0]]]);
  assert.equal(firstPass.expiredAttachments, 1);
  assert.equal(firstPass.hasMoreEligibleAttachments, true);
  assert.equal(firstPass.records[0]?.storedPath, paths[0]);

  const secondPass = await runOnce();
  assert.deepEqual(materializedPaths, [[paths[0]], [paths[1]]]);
  assert.equal(secondPass.expiredAttachments, 1);
  assert.equal(secondPass.hasMoreEligibleAttachments, true);
  assert.equal(secondPass.records[0]?.storedPath, paths[1]);

  const thirdPass = await runOnce();
  assert.deepEqual(materializedPaths, [[paths[0]], [paths[1]], [paths[2]]]);
  assert.equal(thirdPass.expiredAttachments, 1);
  assert.equal(thirdPass.hasMoreEligibleAttachments, false);
  assert.equal(thirdPass.records[0]?.storedPath, paths[2]);
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

test("runInboxMediaRetention aborts before tombstone commit when a wake arrives before append", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-precommit-abort");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const captureId = "cap_retention_precommit_abort";
  const now = "2026-07-05T00:00:00.000Z";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VK",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-precommit-abort",
      thread: {
        id: "thread-precommit-abort",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "precommit abort media",
      attachments: [
        {
          kind: "audio",
          mime: "audio/mp4",
          fileName: "voice.m4a",
          data: Buffer.from("audio-bytes"),
        },
      ],
      raw: {},
    },
  });
  const audioPath = persisted.stored.attachments[0]?.storedPath ?? "";
  assert.ok(audioPath);

  const controller = new AbortController();
  const abortReason = new Error("foreground wake");
  let lstatCount = 0;
  const audioAbsolutePath = path.join(vaultRoot, audioPath);
  const originalLstat = fs.lstat.bind(fs);
  const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
    if (
      !controller.signal.aborted &&
      typeof args[0] === "string" &&
      args[0] === audioAbsolutePath &&
      ++lstatCount === 2
    ) {
      controller.abort(abortReason);
    }
    return await originalLstat(...args);
  });

  try {
    await assert.rejects(
      async () =>
        await runInboxMediaRetention({
          now,
          signal: controller.signal,
          vaultRoot,
        }),
      (error) => error === abortReason,
    );
    assert.equal(await fileExists(vaultRoot, audioPath), true);
    assert.equal(await fileExists(vaultRoot, buildInboxAttachmentRetentionLedgerPath(now)), false);
  } finally {
    lstatSpy.mockRestore();
  }
});

test("rebuildRuntimeFromVault derives retained audio transcript when the tombstone has no manifest pointer", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-derived-fallback");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const captureId = "cap_retention_derived_fallback";
  const attachmentId = `att_${captureId}_01`;
  const transcriptText = "Retained fallback transcript after legacy migration.";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VJ",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-derived-fallback",
      thread: {
        id: "thread-derived-fallback",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "legacy audio media",
      attachments: [
        {
          kind: "audio",
          mime: "audio/mp4",
          fileName: "voice.m4a",
          data: Buffer.from("audio-bytes"),
        },
      ],
      raw: {},
    },
  });
  const audio = persisted.stored.attachments[0];
  assert.ok(audio);
  const audioPath = audio.storedPath ?? "";
  assert.ok(audioPath);
  assert.ok(audio.sha256);

  const writeParserAttempt = async (
    attempt: string,
    text: string,
    createdAt: string,
  ): Promise<string> => {
    const attemptDirectory = `derived/inbox/${captureId}/attachments/${attachmentId}/attempts/${attempt}`;
    const manifestPath = `${attemptDirectory}/manifest.json`;
    const plainTextPath = `${attemptDirectory}/plain.txt`;
    const markdownPath = `${attemptDirectory}/normalized.md`;
    const chunksPath = `${attemptDirectory}/chunks.jsonl`;
    await writeVaultFile(vaultRoot, plainTextPath, `${text}\n`);
    await writeVaultFile(vaultRoot, markdownPath, `${text}\n`);
    await writeVaultFile(vaultRoot, chunksPath, "");
    await writeVaultFile(
      vaultRoot,
      manifestPath,
      `${JSON.stringify({
        schema: "murph.parser-manifest.v1",
        providerId: "test-parser",
        createdAt,
        artifact: {
          attachmentId,
          captureId,
          fileName: "voice.m4a",
          kind: "audio",
          mime: "audio/mp4",
          storedPath: audioPath,
        },
        metadata: {},
        paths: {
          chunksPath,
          markdownPath,
          plainTextPath,
          tablesPath: null,
        },
      })}\n`,
    );
    return manifestPath;
  };
  const manifestPath = await writeParserAttempt(
    "0001",
    transcriptText,
    "2026-06-01T00:01:00.000Z",
  );
  const removedManifestPath = await writeParserAttempt(
    "0002",
    "Removed newer transcript attempt.",
    "2026-06-01T00:02:00.000Z",
  );
  await fs.unlink(path.join(vaultRoot, removedManifestPath));
  await fs.unlink(path.join(vaultRoot, audioPath));
  await appendJsonlRecord({
    vaultRoot,
    relativePath: buildInboxAttachmentRetentionLedgerPath("2026-07-05T00:00:00.000Z"),
    record: {
      schemaVersion: "murph.inbox-attachment-retention.v1",
      captureId,
      attachmentId,
      ordinal: 1,
      kind: "audio",
      mime: "audio/mp4",
      fileName: "voice.m4a",
      byteSize: audio.byteSize ?? null,
      storedPath: audioPath,
      sha256: audio.sha256,
      captureOccurredAt: "2026-06-01T00:00:00.000Z",
      recordedAt: "2026-06-01T00:00:00.000Z",
      purgedAt: "2026-07-05T00:00:00.000Z",
      reason: "inbox_media_retention",
    },
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
    const capture = runtime.getCapture(captureId);
    assert.ok(capture);
    assert.equal(capture.attachments[0]?.storedPath, null);
    assert.equal(capture.attachments[0]?.contentStatus, "retention_expired");
    assert.equal(capture.attachments[0]?.derivedPath, manifestPath);
    assert.equal(capture.attachments[0]?.parseState, "succeeded");
    assert.equal(capture.attachments[0]?.transcriptText, transcriptText);
    assert.equal(runtime.searchCaptures({ limit: 10, text: "fallback transcript" }).length, 1);
  } finally {
    runtime.close();
  }
});

test("rebuildRuntimeFromVault derives available audio transcripts from parser manifests", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-available-derived");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const captureId = "cap_retention_available_derived";
  const attachmentId = `att_${captureId}_01`;
  const transcriptText = "Available audio transcript after rebuild.";
  const inbound: InboundCapture = {
    source: "telegram",
    externalId: "msg-available-derived",
    thread: {
      id: "thread-available-derived",
      isDirect: true,
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-06-01T00:00:00.000Z",
    text: "available audio media",
    attachments: [
      {
        kind: "audio",
        mime: "audio/mp4",
        fileName: "voice.m4a",
        data: Buffer.from("audio-bytes"),
      },
    ],
    raw: {},
  };

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VK",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: inbound,
  });
  const audio = persisted.stored.attachments[0];
  assert.ok(audio);
  const audioPath = audio.storedPath ?? "";
  assert.ok(audioPath);

  const manifestPath = await writeInboxParserAttempt({
    attachmentId,
    captureId,
    createdAt: "2026-06-01T00:01:00.000Z",
    fileName: "voice.m4a",
    kind: "audio",
    mime: "audio/mp4",
    storedPath: audioPath,
    text: transcriptText,
    vaultRoot,
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: true, vaultRoot, runtime });
    const capture = runtime.getCapture(captureId);
    assert.ok(capture);
    assert.equal(capture.attachments[0]?.storedPath, audioPath);
    assert.equal(capture.attachments[0]?.contentStatus, "available");
    assert.equal(capture.attachments[0]?.derivedPath, manifestPath);
    assert.equal(capture.attachments[0]?.parseState, "succeeded");
    assert.equal(capture.attachments[0]?.transcriptText, transcriptText);
    assert.equal(runtime.searchCaptures({ limit: 10, text: "available audio transcript" }).length, 1);
    assert.equal(runtime.listAttachmentParseJobs({ captureId, limit: 10 }).length, 0);

    const pipeline = await createInboxPipeline({ vaultRoot, runtime });
    const replayed = await pipeline.processCapture(inbound);
    assert.equal(replayed.deduped, true);
    assert.equal(replayed.captureId, captureId);
    assert.equal(runtime.getCapture(captureId)?.attachments[0]?.parseState, "succeeded");
    assert.equal(runtime.listAttachmentParseJobs({ captureId, limit: 10 }).length, 0);
  } finally {
    runtime.close();
  }
});

test("rebuildRuntimeFromVault falls back to an older valid parser manifest after a torn newer attempt", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-media-retention-torn-derived");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T00:00:00.000Z" });
  const captureId = "cap_retention_torn_derived";
  const attachmentId = `att_${captureId}_01`;
  const transcriptText = "Older valid transcript survives torn newer attempt.";

  const persisted = await persistCanonicalInboxCapture({
    vaultRoot,
    captureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2VM",
    storedAt: "2026-06-01T00:00:00.000Z",
    input: {
      source: "telegram",
      externalId: "msg-torn-derived",
      thread: {
        id: "thread-torn-derived",
        isDirect: true,
      },
      actor: {
        isSelf: false,
      },
      occurredAt: "2026-06-01T00:00:00.000Z",
      text: "retained audio media with torn derived attempt",
      attachments: [
        {
          kind: "audio",
          mime: "audio/mp4",
          fileName: "voice.m4a",
          data: Buffer.from("audio-bytes"),
        },
      ],
      raw: {},
    },
  });
  const audio = persisted.stored.attachments[0];
  assert.ok(audio);
  const audioPath = audio.storedPath ?? "";
  assert.ok(audioPath);
  assert.ok(audio.sha256);

  const manifestPath = await writeInboxParserAttempt({
    attempt: "0001",
    attachmentId,
    captureId,
    createdAt: "2026-06-01T00:01:00.000Z",
    fileName: "voice.m4a",
    kind: "audio",
    mime: "audio/mp4",
    storedPath: audioPath,
    text: transcriptText,
    vaultRoot,
  });
  await writeInboxParserAttempt({
    attempt: "0002",
    attachmentId,
    captureId,
    createdAt: "2026-06-01T00:02:00.000Z",
    fileName: "voice.m4a",
    kind: "audio",
    mime: "audio/mp4",
    storedPath: audioPath,
    text: "Torn newer transcript.",
    vaultRoot,
  });
  await fs.unlink(path.join(
    vaultRoot,
    `derived/inbox/${captureId}/attachments/${attachmentId}/attempts/0002/plain.txt`,
  ));
  await fs.unlink(path.join(vaultRoot, audioPath));
  await appendJsonlRecord({
    vaultRoot,
    relativePath: buildInboxAttachmentRetentionLedgerPath("2026-07-05T00:00:00.000Z"),
    record: {
      schemaVersion: "murph.inbox-attachment-retention.v1",
      captureId,
      attachmentId,
      ordinal: 1,
      kind: "audio",
      mime: "audio/mp4",
      fileName: "voice.m4a",
      byteSize: audio.byteSize ?? null,
      storedPath: audioPath,
      sha256: audio.sha256,
      captureOccurredAt: "2026-06-01T00:00:00.000Z",
      recordedAt: "2026-06-01T00:00:00.000Z",
      purgedAt: "2026-07-05T00:00:00.000Z",
      reason: "inbox_media_retention",
    },
  });

  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
    const capture = runtime.getCapture(captureId);
    assert.ok(capture);
    assert.equal(capture.attachments[0]?.storedPath, null);
    assert.equal(capture.attachments[0]?.contentStatus, "retention_expired");
    assert.equal(capture.attachments[0]?.derivedPath, manifestPath);
    assert.equal(capture.attachments[0]?.parseState, "succeeded");
    assert.equal(capture.attachments[0]?.transcriptText, transcriptText);
    assert.equal(runtime.searchCaptures({ limit: 10, text: "survives torn newer" }).length, 1);
  } finally {
    runtime.close();
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
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
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

async function writeInboxParserAttempt(input: {
  attempt?: string;
  attachmentId: string;
  captureId: string;
  createdAt: string;
  fileName: string;
  kind: string;
  mime: string;
  storedPath: string;
  text: string;
  vaultRoot: string;
}): Promise<string> {
  const attemptDirectory = `derived/inbox/${input.captureId}/attachments/${input.attachmentId}/attempts/${input.attempt ?? "0001"}`;
  const manifestPath = `${attemptDirectory}/manifest.json`;
  const plainTextPath = `${attemptDirectory}/plain.txt`;
  const markdownPath = `${attemptDirectory}/normalized.md`;
  const chunksPath = `${attemptDirectory}/chunks.jsonl`;
  await writeVaultFile(input.vaultRoot, plainTextPath, `${input.text}\n`);
  await writeVaultFile(input.vaultRoot, markdownPath, `${input.text}\n`);
  await writeVaultFile(input.vaultRoot, chunksPath, "");
  await writeVaultFile(
    input.vaultRoot,
    manifestPath,
    `${JSON.stringify({
      schema: "murph.parser-manifest.v1",
      providerId: "test-parser",
      createdAt: input.createdAt,
      artifact: {
        attachmentId: input.attachmentId,
        captureId: input.captureId,
        fileName: input.fileName,
        kind: input.kind,
        mime: input.mime,
        storedPath: input.storedPath,
      },
      metadata: {},
      paths: {
        chunksPath,
        markdownPath,
        plainTextPath,
        tablesPath: null,
      },
    })}\n`,
  );
  return manifestPath;
}

async function insertLegacyAttachmentParseJob(input: {
  attachmentId: string;
  captureId: string;
  createdAt: string;
  databasePath: string;
  jobId: string;
  state: "pending" | "running";
}): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(input.databasePath);
  try {
    database
      .prepare(
        `
          insert into attachment_parse_job (
            job_id,
            capture_id,
            attachment_id,
            pipeline,
            state,
            attempts,
            created_at
          ) values (?, ?, ?, 'attachment_text', ?, 0, ?)
        `,
      )
      .run(input.jobId, input.captureId, input.attachmentId, input.state, input.createdAt);
  } finally {
    database.close();
  }
}

async function updateAttachmentParseJobTimes(input: {
  createdAt: string;
  databasePath: string;
  jobId: string;
  startedAt: string | null;
}): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(input.databasePath);
  try {
    database
      .prepare(
        `
          update attachment_parse_job
          set created_at = ?,
              started_at = ?
          where job_id = ?
        `,
      )
      .run(input.createdAt, input.startedAt, input.jobId);
  } finally {
    database.close();
  }
}

async function fileExists(vaultRoot: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(vaultRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}
