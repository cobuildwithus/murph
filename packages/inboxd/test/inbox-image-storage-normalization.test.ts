import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault, readJsonlRecords } from "@murphai/core";

import { createInboxPipeline, openInboxRuntime } from "../src/index.ts";
import type { InboundCapture, StoredAttachment } from "../src/contracts/capture.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "email",
    externalId: "msg-image-normalization",
    accountId: "self",
    thread: {
      id: "thread-image-normalization",
      isDirect: true,
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:00:00.000Z",
    receivedAt: "2026-03-13T12:00:05.000Z",
    text: "Attachment evidence",
    attachments: [],
    raw: {},
    ...overrides,
  };
}

async function createImageBytes(input: {
  format: "jpeg" | "png" | "webp";
  width?: number;
  height?: number;
}): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const image = sharp({
    create: {
      width: input.width ?? 4200,
      height: input.height ?? 1600,
      channels: 3,
      background: { r: 24, g: 128, b: 176 },
    },
  });

  switch (input.format) {
    case "jpeg":
      return new Uint8Array(await image.jpeg({ quality: 95 }).toBuffer());
    case "png":
      return new Uint8Array(await image.png().toBuffer());
    case "webp":
      return new Uint8Array(await image.webp({ quality: 95 }).toBuffer());
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectStoredAttachment(
  attachment: StoredAttachment | undefined,
): StoredAttachment & { storedPath: string; byteSize: number; sha256: string } {
  assert.ok(attachment);
  assert.equal(typeof attachment.storedPath, "string");
  assert.equal(typeof attachment.byteSize, "number");
  assert.equal(typeof attachment.sha256, "string");
  return attachment as StoredAttachment & {
    storedPath: string;
    byteSize: number;
    sha256: string;
  };
}

async function assertStoredWebp(input: {
  vaultRoot: string;
  attachment: StoredAttachment | undefined;
  expectedFileName: string;
  originalByteSize?: number;
}): Promise<Uint8Array> {
  const attachment = expectStoredAttachment(input.attachment);
  assert.equal(attachment.mime, "image/webp");
  assert.equal(attachment.fileName, input.expectedFileName);
  assert.match(attachment.storedPath, /\/attachments\/\d{2}__.+\.webp$/u);
  if (input.originalByteSize !== undefined) {
    assert.notEqual(attachment.byteSize, input.originalByteSize);
  }

  const storedBytes = new Uint8Array(
    await fs.readFile(path.join(input.vaultRoot, attachment.storedPath)),
  );
  assert.equal(attachment.byteSize, storedBytes.byteLength);
  assert.equal(attachment.sha256, sha256(storedBytes));

  const sharp = (await import("sharp")).default;
  const metadata = await sharp(storedBytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok((metadata.width ?? 0) <= 3072);
  assert.ok((metadata.height ?? 0) <= 3072);

  return storedBytes;
}

test("processCapture normalizes JPEG image data before canonical inbox storage and parser enqueue", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-image-normalize-jpeg");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const originalBytes = await createImageBytes({ format: "jpeg" });
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });

  const persisted = await pipeline.processCapture(createCapture({
    externalId: "msg-image-normalize-jpeg",
    attachments: [
      {
        externalId: "att-jpeg",
        kind: "image",
        mime: "image/jpeg",
        fileName: "lab.jpeg",
        byteSize: originalBytes.byteLength,
        data: originalBytes,
      },
    ],
  }));

  const capture = runtime.getCapture(persisted.captureId);
  assert.ok(capture);
  const attachment = expectStoredAttachment(capture.attachments[0]);
  const storedBytes = await assertStoredWebp({
    vaultRoot,
    attachment,
    expectedFileName: "lab.webp",
    originalByteSize: originalBytes.byteLength,
  });
  assert.notDeepEqual(storedBytes, originalBytes);

  const jobs = runtime.listAttachmentParseJobs({ limit: 10 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.captureId, persisted.captureId);
  assert.equal(jobs[0]?.attachmentId, attachment.attachmentId);
  assert.equal(jobs[0]?.state, "pending");

  const envelope = JSON.parse(
    await fs.readFile(path.join(vaultRoot, capture.envelopePath), "utf8"),
  ) as {
    input: { attachments: Array<{ mime: string | null; fileName: string | null; byteSize: number | null }> };
    stored: { attachments: StoredAttachment[] };
  };
  assert.deepEqual(selectInboundAttachmentStorageFields(envelope.input.attachments[0]), {
    mime: "image/webp",
    fileName: "lab.webp",
    byteSize: storedBytes.byteLength,
  });
  assert.equal(envelope.stored.attachments[0]?.mime, "image/webp");
  assert.equal(envelope.stored.attachments[0]?.fileName, "lab.webp");
  assert.equal(envelope.stored.attachments[0]?.byteSize, storedBytes.byteLength);
  assert.equal(envelope.stored.attachments[0]?.sha256, sha256(storedBytes));

  const captureRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });
  assert.equal(captureRecords.length, 1);
  const captureRecord = captureRecords[0] as {
    attachments: Array<{ mime: string | null; fileName: string | null; byteSize: number | null; sha256: string | null }>;
    rawRefs: string[];
  };
  assert.deepEqual(selectStoredAttachmentStorageFields(captureRecord.attachments[0]), {
    mime: "image/webp",
    fileName: "lab.webp",
    byteSize: storedBytes.byteLength,
    sha256: sha256(storedBytes),
  });
  assert.equal(captureRecord.rawRefs.includes(attachment.storedPath), true);

  pipeline.close();
});

test("processCapture normalizes PNG and WebP original-path images into bounded WebP evidence", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-image-normalize-file");
  const sourceRoot = await makeTempDirectory("murph-inbox-image-normalize-source");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const cases = [
    { format: "png" as const, mime: "image/png", fileName: "chart.png", expected: "chart.webp" },
    { format: "webp" as const, mime: "image/webp", fileName: "scan.webp", expected: "scan.webp" },
  ];

  for (const [index, imageCase] of cases.entries()) {
    const originalBytes = await createImageBytes({
      format: imageCase.format,
      width: 3900 + index,
      height: 1800,
    });
    const originalPath = path.join(sourceRoot, imageCase.fileName);
    await fs.writeFile(originalPath, originalBytes);
    const persisted = await pipeline.processCapture(createCapture({
      externalId: `msg-image-normalize-${imageCase.format}`,
      occurredAt: `2026-03-13T12:0${index + 1}:00.000Z`,
      attachments: [
        {
          externalId: `att-${imageCase.format}`,
          kind: "image",
          mime: imageCase.mime,
          originalPath,
          fileName: imageCase.fileName,
          byteSize: originalBytes.byteLength,
        },
      ],
    }));
    const capture = runtime.getCapture(persisted.captureId);
    assert.ok(capture);
    await assertStoredWebp({
      vaultRoot,
      attachment: capture.attachments[0],
      expectedFileName: imageCase.expected,
      originalByteSize: originalBytes.byteLength,
    });
  }

  assert.equal(runtime.listAttachmentParseJobs({ limit: 10 }).length, cases.length);

  pipeline.close();
});

test("processCapture leaves non-image attachment bytes unchanged", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-image-normalize-non-image");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const bytes = new Uint8Array(Buffer.from("plain document evidence"));
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const persisted = await pipeline.processCapture(createCapture({
    externalId: "msg-non-image",
    attachments: [
      {
        externalId: "att-non-image",
        kind: "document",
        mime: "text/plain",
        fileName: "notes.txt",
        data: bytes,
      },
    ],
  }));
  const capture = runtime.getCapture(persisted.captureId);
  assert.ok(capture);
  const attachment = expectStoredAttachment(capture.attachments[0]);
  assert.equal(attachment.mime, "text/plain");
  assert.equal(attachment.fileName, "notes.txt");
  assert.match(attachment.storedPath, /\/attachments\/01__notes\.txt$/u);
  assert.deepEqual(
    new Uint8Array(await fs.readFile(path.join(vaultRoot, attachment.storedPath))),
    bytes,
  );

  pipeline.close();
});

test("processCapture fails closed for corrupt eligible images without persisting original bytes", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-image-normalize-corrupt");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const corruptBytes = new Uint8Array(Buffer.from("not an image"));
  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  const persisted = await pipeline.processCapture(createCapture({
    externalId: "msg-corrupt-image",
    attachments: [
      {
        externalId: "att-corrupt",
        kind: "image",
        mime: "image/jpeg",
        fileName: "broken.jpg",
        byteSize: corruptBytes.byteLength,
        data: corruptBytes,
      },
    ],
  }));
  const capture = runtime.getCapture(persisted.captureId);
  assert.ok(capture);
  const attachment = capture.attachments[0];
  assert.ok(attachment);
  assert.equal(attachment.storedPath, null);
  assert.equal(attachment.sha256, null);
  assert.equal(attachment.byteSize, null);
  assert.equal(attachment.originalPath, null);
  assert.equal(runtime.listAttachmentParseJobs({ limit: 10 }).length, 0);

  const envelope = JSON.parse(
    await fs.readFile(path.join(vaultRoot, capture.envelopePath), "utf8"),
  ) as {
    input: { attachments: Array<{ byteSize: number | null; originalPath: string | null }> };
    stored: { attachments: Array<{ storedPath: string | null; byteSize: number | null; sha256: string | null }> };
  };
  assert.deepEqual(selectCorruptInboundAttachmentFields(envelope.input.attachments[0]), {
    byteSize: null,
    originalPath: null,
  });
  assert.deepEqual(selectCorruptStoredAttachmentFields(envelope.stored.attachments[0]), {
    storedPath: null,
    byteSize: null,
    sha256: null,
  });

  const captureRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/inbox-captures/2026/2026-03.jsonl",
  });
  assert.equal(captureRecords.length, 1);
  const captureRecord = captureRecords[0] as {
    attachments: Array<{ storedPath: string | null; byteSize: number | null; sha256: string | null }>;
    rawRefs: string[];
  };
  assert.deepEqual(selectCorruptStoredAttachmentFields(captureRecord.attachments[0]), {
    storedPath: null,
    byteSize: null,
    sha256: null,
  });
  assert.equal(captureRecord.rawRefs.some((rawRef) => rawRef.includes("/attachments/")), false);

  pipeline.close();
});

function selectInboundAttachmentStorageFields(
  attachment: { mime: string | null; fileName: string | null; byteSize: number | null } | undefined,
): { mime: string | null; fileName: string | null; byteSize: number | null } {
  assert.ok(attachment);
  return {
    mime: attachment.mime,
    fileName: attachment.fileName,
    byteSize: attachment.byteSize,
  };
}

function selectStoredAttachmentStorageFields(
  attachment: {
    mime: string | null;
    fileName: string | null;
    byteSize: number | null;
    sha256: string | null;
  } | undefined,
): {
  mime: string | null;
  fileName: string | null;
  byteSize: number | null;
  sha256: string | null;
} {
  assert.ok(attachment);
  return {
    mime: attachment.mime,
    fileName: attachment.fileName,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256,
  };
}

function selectCorruptInboundAttachmentFields(
  attachment: { byteSize: number | null; originalPath: string | null } | undefined,
): { byteSize: number | null; originalPath: string | null } {
  assert.ok(attachment);
  return {
    byteSize: attachment.byteSize,
    originalPath: attachment.originalPath,
  };
}

function selectCorruptStoredAttachmentFields(
  attachment: {
    storedPath: string | null;
    byteSize: number | null;
    sha256: string | null;
  } | undefined,
): { storedPath: string | null; byteSize: number | null; sha256: string | null } {
  assert.ok(attachment);
  return {
    storedPath: attachment.storedPath,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256,
  };
}
