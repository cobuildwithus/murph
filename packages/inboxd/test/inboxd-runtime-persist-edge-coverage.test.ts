import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault } from "@murphai/core";

import * as indexSurface from "../src/index.ts";
import * as runtimeSurface from "../src/runtime.ts";
import type { StoredCaptureEnvelope } from "../src/indexing/persist.ts";
import type { InboundCapture } from "../src/contracts/capture.ts";
import { findStoredCaptureEnvelope } from "../src/indexing/persist.ts";
import { createDeterministicInboxCaptureId } from "../src/shared.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function writeExternalFile(directory: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "imessage",
    externalId: "msg-persist-edge-1",
    accountId: "self",
    thread: {
      id: "chat-persist-edge",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:30:00.000Z",
    receivedAt: "2026-03-13T12:30:05.000Z",
    text: "Persist edge coverage",
    attachments: [],
    raw: {},
    ...overrides,
  };
}

async function readEnvelopeFile(
  absolutePath: string,
): Promise<StoredCaptureEnvelope & { stored: { attachments: Array<Record<string, unknown>> } }> {
  return JSON.parse(await fs.readFile(absolutePath, "utf8")) as StoredCaptureEnvelope & {
    stored: { attachments: Array<Record<string, unknown>> };
  };
}

test("runtime barrel keeps the rebuild seam aligned with the package surface", () => {
  assert.equal(runtimeSurface.rebuildRuntimeFromVault, indexSurface.rebuildRuntimeFromVault);
});

test("findStoredCaptureEnvelope quarantines unsafe canonical envelopes with a collision-safe suffix and falls back to a legacy-safe envelope", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-find-envelope-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-find-envelope-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attachmentPath = await writeExternalFile(sourceRoot, "fallback-note.txt", "legacy attachment");
  const inbound = createCapture({
    externalId: "msg-find-envelope-fallback",
    attachments: [
      {
        externalId: "att-find-envelope",
        kind: "document",
        mime: "text/plain",
        originalPath: attachmentPath,
        fileName: "fallback-note.txt",
      },
    ],
  });
  const canonicalCaptureId = createDeterministicInboxCaptureId(inbound);
  const legacyCaptureId = "cap_legacy_safe_fallback";

  await indexSurface.persistRawCapture({
    vaultRoot,
    captureId: legacyCaptureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA01",
    input: inbound,
    storedAt: "2026-03-13T12:31:00.000Z",
  });
  const canonicalStored = await indexSurface.persistRawCapture({
    vaultRoot,
    captureId: canonicalCaptureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA02",
    input: inbound,
    storedAt: "2026-03-13T12:32:00.000Z",
  });

  const canonicalEnvelopePath = path.join(vaultRoot, canonicalStored.envelopePath);
  const canonicalEnvelope = await readEnvelopeFile(canonicalEnvelopePath);
  canonicalEnvelope.captureId = "../../escaped-capture";
  await fs.writeFile(canonicalEnvelopePath, `${JSON.stringify(canonicalEnvelope, null, 2)}\n`, "utf8");

  const quarantinePath = path.join(
    path.dirname(canonicalEnvelopePath),
    "envelope.quarantined-invalid-capture-id.json",
  );
  await fs.writeFile(quarantinePath, "{\"existing\":true}\n", "utf8");

  const envelope = await findStoredCaptureEnvelope({
    vaultRoot,
    inbound,
    captureId: canonicalCaptureId,
  });

  assert.ok(envelope);
  assert.equal(envelope.captureId, canonicalCaptureId);
  assert.equal(envelope.stored.captureId, canonicalCaptureId);
  assert.equal(envelope.stored.attachments[0]?.attachmentId, `att_${canonicalCaptureId}_01`);
  assert.match(envelope.stored.attachments[0]?.storedPath ?? "", /fallback-note\.txt$/u);
  assert.equal(await pathExists(canonicalEnvelopePath), false);
  assert.equal(await pathExists(quarantinePath), true);
  assert.equal(
    await pathExists(
      path.join(
        path.dirname(canonicalEnvelopePath),
        "envelope.quarantined-invalid-capture-id-1.json",
      ),
    ),
    true,
  );
});

test("rebuildRuntimeFromVault rewrites legacy attachment ids from canonical ordinals before indexing parse jobs", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-rebuild-attachment-normalization-vault");
  const sourceRoot = await makeTempDirectory("murph-inbox-rebuild-attachment-normalization-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const firstAttachmentPath = await writeExternalFile(sourceRoot, "first.txt", "first attachment");
  const secondAttachmentPath = await writeExternalFile(sourceRoot, "second.txt", "second attachment");
  const inbound = createCapture({
    externalId: "msg-rebuild-attachment-normalization",
    attachments: [
      {
        externalId: "att-first",
        kind: "document",
        mime: "text/plain",
        originalPath: firstAttachmentPath,
        fileName: "first.txt",
      },
      {
        externalId: "att-second",
        kind: "document",
        mime: "text/plain",
        originalPath: secondAttachmentPath,
        fileName: "second.txt",
      },
    ],
  });
  const canonicalCaptureId = createDeterministicInboxCaptureId(inbound);
  const legacyCaptureId = "cap_legacyattachmentnorm";
  const stored = await indexSurface.persistRawCapture({
    vaultRoot,
    captureId: legacyCaptureId,
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VA03",
    input: inbound,
    storedAt: "2026-03-13T12:33:00.000Z",
  });

  const legacyEnvelopePath = path.join(vaultRoot, stored.envelopePath);
  const legacyEnvelope = await readEnvelopeFile(legacyEnvelopePath);
  legacyEnvelope.stored.attachments = legacyEnvelope.stored.attachments.map((attachment, index) => ({
    ...attachment,
    attachmentId: `legacy-att-${index + 1}`,
  }));
  await fs.writeFile(legacyEnvelopePath, `${JSON.stringify(legacyEnvelope, null, 2)}\n`, "utf8");

  const runtime = await indexSurface.openInboxRuntime({ vaultRoot });

  try {
    await indexSurface.rebuildRuntimeFromVault({ vaultRoot, runtime });

    const capture = runtime.getCapture(canonicalCaptureId);
    assert.ok(capture);
    assert.equal(capture.captureId, canonicalCaptureId);
    assert.equal(runtime.getCapture(legacyCaptureId), null);
    assert.deepEqual(
      capture.attachments.map((attachment) => attachment.attachmentId),
      [`att_${canonicalCaptureId}_01`, `att_${canonicalCaptureId}_02`],
    );
    assert.deepEqual(
      runtime.listAttachmentParseJobs({ limit: 10 }).map((job) => job.attachmentId).sort(),
      [`att_${canonicalCaptureId}_01`, `att_${canonicalCaptureId}_02`],
    );
  } finally {
    runtime.close();
  }
});

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
