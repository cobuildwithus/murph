import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  addCaptureWithLookup,
  findCaptureByLookup,
  initializeVault,
  readJsonlRecords,
  runGeneratedImageCaptureRetention,
  validateVault,
} from "@murphai/core";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((targetPath) =>
      rm(targetPath, { recursive: true, force: true })
    ),
  );
});

async function createTempVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-generated-retention-"));
  cleanupPaths.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    title: "Generated Image Retention Test Vault",
    timezone: "UTC",
  });
  return vaultRoot;
}

async function addGeneratedCapture(input: {
  content?: string;
  lookupKey: string;
  recordedAt: string;
  vaultRoot: string;
}) {
  const fixtureDirectory = path.join(input.vaultRoot, ".fixtures");
  await mkdir(fixtureDirectory, { recursive: true });
  const sourcePath = path.join(
    fixtureDirectory,
    `${input.lookupKey.replaceAll(/[^a-z0-9]/giu, "-")}.png`,
  );
  await writeFile(sourcePath, input.content ?? `image:${input.lookupKey}`);

  return addCaptureWithLookup({
    attachments: [{ role: "media_1", sourcePath }],
    draft: {
      note: "Assistant-generated image saved for later visual reuse.",
      occurredAt: input.recordedAt,
      recordedAt: input.recordedAt,
      source: "derived",
      tags: ["assistant-generated-image", "generated-image"],
      title: "Generated image",
    },
    lookupAttachmentRole: "media_1",
    lookupKey: input.lookupKey,
    rawImport: {
      importKind: "capture",
      importedAt: input.recordedAt,
      provenance: {
        family: "capture",
        generatedImage: {
          schema: "murph.generated-image.v1",
        },
        mediaCount: 1,
      },
      source: "murph.generate_image",
    },
    vaultRoot: input.vaultRoot,
  });
}

async function readLookupIndex(vaultRoot: string): Promise<{
  entries: Record<string, { retiredAt?: string }>;
}> {
  return JSON.parse(
    await readFile(
      path.join(vaultRoot, "derived/captures/generated-image-lookups.json"),
      "utf8",
    ),
  );
}

describe("generated image capture retention", () => {
  it("is a no-op when an empty checkpoint workspace has no lookup index", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-empty-retention-"));
    cleanupPaths.push(vaultRoot);

    await expect(runGeneratedImageCaptureRetention({ vaultRoot })).resolves.toEqual({
      blockedCaptureCount: 0,
      hasMoreEligibleCaptures: false,
      nextEligibleAt: null,
      retiredByteCount: 0,
      retiredCaptureCount: 0,
      scannedCaptureCount: 0,
    });
    await expect(readdir(vaultRoot)).resolves.toEqual([]);
  });

  it("atomically retires generated image bytes at 14 days and blocks replay", async () => {
    const vaultRoot = await createTempVault();
    const recordedAt = "2026-07-01T12:00:00.000Z";
    const now = new Date("2026-07-15T12:00:00.000Z");
    const originalContent = "generated-image-payload";
    const capture = await addGeneratedCapture({
      content: originalContent,
      lookupKey: "generated:exact-cutoff",
      recordedAt,
      vaultRoot,
    });
    const attachmentRef = capture.event.attachments?.[0]?.relativePath;
    expect(attachmentRef).toBeTruthy();

    const result = await runGeneratedImageCaptureRetention({ now, vaultRoot });

    expect(result).toMatchObject({
      hasMoreEligibleCaptures: false,
      nextEligibleAt: null,
      retiredByteCount: Buffer.byteLength(originalContent),
      retiredCaptureCount: 1,
      scannedCaptureCount: 1,
    });
    const tombstone = JSON.parse(
      await readFile(path.join(vaultRoot, attachmentRef!), "utf8"),
    );
    expect(tombstone).toEqual({
      purgedAt: now.toISOString(),
      reason: "generated_image_retention",
      schemaVersion: "murph.generated-image-retention-tombstone.v1",
    });
    const manifest = JSON.parse(
      await readFile(path.join(vaultRoot, capture.manifestPath!), "utf8"),
    );
    expect(manifest).toMatchObject({
      artifacts: [{
        mediaType: "application/json",
        originalFileName: "generated-image-retention-tombstone.json",
        role: "privacy_tombstone",
      }],
      provenance: {
        generatedImageRetention: {
          purgedAt: now.toISOString(),
          reason: "generated_image_retention",
        },
      },
    });
    await expect(findCaptureByLookup({
      lookupKey: "generated:exact-cutoff",
      vaultRoot,
    })).resolves.toMatchObject({
      eventId: capture.eventId,
      status: "deleted",
    });
    const ledger = await readJsonlRecords({
      relativePath: capture.ledgerFile,
      vaultRoot,
    });
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({
      id: capture.eventId,
      lifecycle: { revision: 2, state: "deleted" },
    });
    expect((await validateVault({ vaultRoot })).valid).toBe(true);

    await expect(runGeneratedImageCaptureRetention({ now, vaultRoot }))
      .resolves.toMatchObject({ retiredCaptureCount: 0, scannedCaptureCount: 0 });
  });

  it("leaves fresh generated captures and unrelated lookup-backed captures untouched", async () => {
    const vaultRoot = await createTempVault();
    const fresh = await addGeneratedCapture({
      lookupKey: "generated:fresh",
      recordedAt: "2026-07-10T00:00:00.000Z",
      vaultRoot,
    });
    const fixturePath = path.join(vaultRoot, ".fixtures", "durable.png");
    await writeFile(fixturePath, "durable-capture");
    const durable = await addCaptureWithLookup({
      attachments: [{ role: "media_1", sourcePath: fixturePath }],
      draft: {
        note: "Longitudinal tracking image.",
        occurredAt: "2026-06-01T00:00:00.000Z",
        recordedAt: "2026-06-01T00:00:00.000Z",
        source: "manual",
        title: "Durable progress photo",
      },
      lookupAttachmentRole: "media_1",
      lookupKey: "durable:tracking",
      vaultRoot,
    });

    const result = await runGeneratedImageCaptureRetention({
      now: new Date("2026-07-15T00:00:00.000Z"),
      vaultRoot,
    });

    expect(result).toEqual({
      blockedCaptureCount: 0,
      hasMoreEligibleCaptures: false,
      nextEligibleAt: "2026-07-24T00:00:00.000Z",
      retiredByteCount: 0,
      retiredCaptureCount: 0,
      scannedCaptureCount: 2,
    });
    await expect(readFile(
      path.join(vaultRoot, fresh.event.attachments![0]!.relativePath),
      "utf8",
    )).resolves.toBe("image:generated:fresh");
    await expect(readFile(
      path.join(vaultRoot, durable.event.attachments![0]!.relativePath),
      "utf8",
    )).resolves.toBe("durable-capture");
  });

  it("rechecks protected generated captures and bounds each maintenance slice", async () => {
    const vaultRoot = await createTempVault();
    const protectedCapture = await addGeneratedCapture({
      lookupKey: "generated:protected",
      recordedAt: "2026-06-01T00:00:00.000Z",
      vaultRoot,
    });
    await addGeneratedCapture({
      lookupKey: "generated:eligible-one",
      recordedAt: "2026-06-02T00:00:00.000Z",
      vaultRoot,
    });
    await addGeneratedCapture({
      lookupKey: "generated:eligible-two",
      recordedAt: "2026-06-03T00:00:00.000Z",
      vaultRoot,
    });
    await addGeneratedCapture({
      lookupKey: "generated:eligible-three",
      recordedAt: "2026-06-04T00:00:00.000Z",
      vaultRoot,
    });
    const now = new Date("2026-07-15T00:00:00.000Z");

    const first = await runGeneratedImageCaptureRetention({
      maxCaptures: 2,
      now,
      protectedCaptureIds: [protectedCapture.eventId],
      vaultRoot,
    });

    expect(first).toMatchObject({
      hasMoreEligibleCaptures: true,
      nextEligibleAt: "2026-07-16T00:00:00.000Z",
      retiredCaptureCount: 2,
    });
    const second = await runGeneratedImageCaptureRetention({
      maxCaptures: 1,
      now,
      protectedCaptureIds: [protectedCapture.eventId],
      vaultRoot,
    });
    expect(second).toMatchObject({
      hasMoreEligibleCaptures: false,
      nextEligibleAt: "2026-07-16T00:00:00.000Z",
      retiredCaptureCount: 1,
    });
    await expect(findCaptureByLookup({
      lookupKey: "generated:protected",
      vaultRoot,
    })).resolves.toMatchObject({ status: "live" });
  });

  it("retires valid captures when a neighboring capture loses canonical integrity", async () => {
    const vaultRoot = await createTempVault();
    const first = await addGeneratedCapture({
      lookupKey: "generated:atomic-one",
      recordedAt: "2026-06-01T00:00:00.000Z",
      vaultRoot,
    });
    const second = await addGeneratedCapture({
      lookupKey: "generated:atomic-two",
      recordedAt: "2026-06-01T00:00:00.000Z",
      vaultRoot,
    });
    const firstRef = first.event.attachments![0]!.relativePath;
    const secondRef = second.event.attachments![0]!.relativePath;
    await writeFile(path.join(vaultRoot, secondRef), "tampered-image");
    const now = new Date("2026-07-15T00:00:00.000Z");

    await expect(runGeneratedImageCaptureRetention({
      now,
      vaultRoot,
    })).resolves.toMatchObject({
      blockedCaptureCount: 1,
      nextEligibleAt: "2026-07-16T00:00:00.000Z",
      retiredCaptureCount: 1,
    });

    await expect(readFile(path.join(vaultRoot, firstRef), "utf8"))
      .resolves.toContain("generated_image_retention");
    await expect(readFile(path.join(vaultRoot, secondRef), "utf8"))
      .resolves.toBe("tampered-image");
    const index = await readLookupIndex(vaultRoot);
    expect(Object.values(index.entries).filter((entry) => entry.retiredAt === now.toISOString()))
      .toHaveLength(1);
    await expect(findCaptureByLookup({
      lookupKey: "generated:atomic-one",
      vaultRoot,
    })).resolves.toMatchObject({ status: "deleted" });
    await expect(findCaptureByLookup({
      lookupKey: "generated:atomic-two",
      vaultRoot,
    })).resolves.toMatchObject({ status: "live" });
  });
});
