import path from "node:path";
import { tmpdir } from "node:os";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addCaptureWithLookup,
  applyHostedCanonicalWriteReceipt,
  findCaptureByLookup,
  initializeVault,
  readJsonlRecords,
  runGeneratedImageCaptureRetention,
  validateVault,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePersistenceInput,
  VaultError,
} from "@murphai/core";

const emptyBlockedCaptureCounts = {
  GENERATED_IMAGE_RETENTION_ATTACHMENT_INVALID: 0,
  GENERATED_IMAGE_RETENTION_EVENT_INVALID: 0,
  GENERATED_IMAGE_RETENTION_EVENT_MISSING: 0,
  GENERATED_IMAGE_RETENTION_MANIFEST_INVALID: 0,
  GENERATED_IMAGE_RETENTION_PRECONDITION_FAILED: 0,
  VAULT_FILE_MISSING: 0,
};

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
  it("retires a due image reported missing by the materializer without counting absent bytes", async () => {
    const vaultRoot = await createTempVault();
    const capture = await addGeneratedCapture({
      lookupKey: "generated:expired-hosted-image",
      recordedAt: "2026-07-01T12:00:00.000Z",
      vaultRoot,
    });
    const attachmentRef = capture.event.attachments![0]!.relativePath;
    await rm(path.join(vaultRoot, attachmentRef));
    const replayRoot = await createTempVault();
    await cp(vaultRoot, replayRoot, { recursive: true });
    const persisted: HostedCanonicalWritePersistenceInput[] = [];
    const input = {
      now: new Date("2026-07-15T12:00:00.000Z"),
      vaultRoot,
      materializeCandidatePaths: async () => ({ missingStoredPaths: [attachmentRef] }),
    };

    await expect(withHostedCanonicalWritePort({
      async persistCanonicalWrite(write) { persisted.push(write); },
    }, () => runGeneratedImageCaptureRetention(input))).resolves.toMatchObject({
      blockedCaptureCount: 0,
      retiredByteCount: 0,
      retiredCaptureCount: 1,
      nextEligibleAt: null,
    });
    await expect(findCaptureByLookup({
      vaultRoot,
      lookupKey: "generated:expired-hosted-image",
    })).resolves.toMatchObject({ status: "deleted" });
    const tombstone = JSON.parse(await readFile(path.join(vaultRoot, attachmentRef), "utf8"));
    expect(tombstone.reason).toBe("generated_image_retention");
    expect((await validateVault({ vaultRoot })).valid).toBe(true);
    expect(persisted).toHaveLength(1);
    const write = persisted[0]!;
    expect(write.receipt.actions[0]).toMatchObject({
      kind: "text_upsert", targetRelativePath: attachmentRef, effect: "create", allowRaw: true,
    });
    const replay = () => applyHostedCanonicalWriteReceipt({
      vaultRoot: replayRoot,
      receipt: write.receipt,
      readPayload: async (ref) => write.payloads.find((payload) => payload.sha256 === ref.sha256)?.bytes ?? null,
    });
    await replay();
    await replay();
    expect(await findCaptureByLookup({ vaultRoot: replayRoot, lookupKey: "generated:expired-hosted-image" }))
      .toMatchObject({ status: "deleted" });
    await writeFile(path.join(replayRoot, attachmentRef), "unexpected bytes");
    await expect(replay()).rejects.toMatchObject({ code: "HOSTED_CANONICAL_WRITE_RAW_CONFLICT" });
    expect(await readFile(path.join(replayRoot, attachmentRef), "utf8")).toBe("unexpected bytes");
    await expect(runGeneratedImageCaptureRetention(input)).resolves.toMatchObject({
      blockedCaptureCount: 0,
      retiredCaptureCount: 0,
      nextEligibleAt: null,
    });
  });

  it.each(["unreported", "changed", "manifest-hash", "manifest-owner"])(
    "does not let the missing-path report bypass %s validation",
    async (scenario) => {
      const vaultRoot = await createTempVault();
      const lookupKey = `generated:missing-${scenario}`;
      const capture = await addGeneratedCapture({
        lookupKey, recordedAt: "2026-07-01T12:00:00.000Z", vaultRoot,
      });
      const attachmentRef = capture.event.attachments![0]!.relativePath;
      if (scenario === "changed") {
        await writeFile(path.join(vaultRoot, attachmentRef), "changed bytes");
      } else {
        await rm(path.join(vaultRoot, attachmentRef));
      }
      const manifestPath = path.join(vaultRoot, capture.manifestPath!);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (scenario === "manifest-hash") manifest.artifacts[0].sha256 = "0".repeat(64);
      if (scenario === "manifest-owner") manifest.owner.id = "another-capture";
      await writeFile(manifestPath, JSON.stringify(manifest));
      const result = await runGeneratedImageCaptureRetention({
        vaultRoot, now: new Date("2026-07-15T12:00:00.000Z"),
        materializeCandidatePaths: async () => ({
          missingStoredPaths: scenario === "unreported" ? ["raw/unrelated.png"] : [attachmentRef],
        }),
      });
      expect(result).toMatchObject({ blockedCaptureCount: 1, retiredCaptureCount: 0 });
      expect(await findCaptureByLookup({ vaultRoot, lookupKey })).toMatchObject({ status: "live" });
      expect(await readFile(manifestPath, "utf8")).toBe(JSON.stringify(manifest));
      if (scenario === "changed") {
        expect(await readFile(path.join(vaultRoot, attachmentRef), "utf8")).toBe("changed bytes");
      } else {
        await expect(readFile(path.join(vaultRoot, attachmentRef))).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );

  it("is a no-op when an empty checkpoint workspace has no lookup index", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-empty-retention-"));
    cleanupPaths.push(vaultRoot);

    await expect(runGeneratedImageCaptureRetention({ vaultRoot })).resolves.toEqual({
      blockedCaptureCount: 0,
      blockedCaptureCounts: emptyBlockedCaptureCounts,
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
      blockedCaptureCount: 0,
      blockedCaptureCounts: emptyBlockedCaptureCounts,
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
      .resolves.toMatchObject({
        blockedCaptureCount: 0,
        blockedCaptureCounts: emptyBlockedCaptureCounts,
        retiredCaptureCount: 0,
        scannedCaptureCount: 0,
      });
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
      blockedCaptureCounts: emptyBlockedCaptureCounts,
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
      blockedCaptureCount: 0,
      blockedCaptureCounts: emptyBlockedCaptureCounts,
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
      blockedCaptureCount: 0,
      blockedCaptureCounts: emptyBlockedCaptureCounts,
      hasMoreEligibleCaptures: false,
      nextEligibleAt: "2026-07-16T00:00:00.000Z",
      retiredCaptureCount: 1,
    });
    await expect(findCaptureByLookup({
      lookupKey: "generated:protected",
      vaultRoot,
    })).resolves.toMatchObject({ status: "live" });
  });

  it("distinguishes missing events from changed bytes while retiring a valid neighbor", async () => {
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
    const missing: Awaited<ReturnType<typeof addGeneratedCapture>>[] = [];
    for (const suffix of ["one", "two"]) {
      missing.push(await addGeneratedCapture({
        lookupKey: `generated:missing-${suffix}`,
        recordedAt: "2026-06-01T00:00:00.000Z",
        vaultRoot,
      }));
    }
    const missingIds = new Set(missing.map((capture) => capture.eventId));
    const records = await readJsonlRecords({ relativePath: first.ledgerFile, vaultRoot });
    await writeFile(
      path.join(vaultRoot, first.ledgerFile),
      records.filter((record) => !missingIds.has(String(record.id)))
        .map((record) => `${JSON.stringify(record)}\n`).join(""),
    );
    const firstRef = first.event.attachments![0]!.relativePath;
    const secondRef = second.event.attachments![0]!.relativePath;
    await writeFile(path.join(vaultRoot, secondRef), "tampered-image");
    const now = new Date("2026-07-15T00:00:00.000Z");

    await expect(runGeneratedImageCaptureRetention({
      now,
      vaultRoot,
    })).resolves.toMatchObject({
      blockedCaptureCount: 3,
      blockedCaptureCounts: {
        ...emptyBlockedCaptureCounts,
        GENERATED_IMAGE_RETENTION_EVENT_MISSING: 2,
        GENERATED_IMAGE_RETENTION_PRECONDITION_FAILED: 1,
      },
      hasMoreEligibleCaptures: false,
      nextEligibleAt: "2026-07-16T00:00:00.000Z",
      retiredByteCount: Buffer.byteLength("image:generated:atomic-one"),
      retiredCaptureCount: 1,
      scannedCaptureCount: 4,
    });

    await expect(readFile(path.join(vaultRoot, firstRef), "utf8"))
      .resolves.toContain("generated_image_retention");
    await expect(readFile(path.join(vaultRoot, secondRef), "utf8"))
      .resolves.toBe("tampered-image");
    for (const capture of missing) {
      await expect(readFile(
        path.join(vaultRoot, capture.event.attachments![0]!.relativePath), "utf8",
      )).resolves.toMatch(/^image:generated:missing-/u);
    }
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

  it.each([
    "GENERATED_IMAGE_RETENTION_ATTACHMENT_INVALID",
    "GENERATED_IMAGE_RETENTION_EVENT_INVALID",
    "GENERATED_IMAGE_RETENTION_EVENT_MISSING",
    "GENERATED_IMAGE_RETENTION_MANIFEST_INVALID",
    "GENERATED_IMAGE_RETENTION_PRECONDITION_FAILED",
    "VAULT_FILE_MISSING",
  ])("counts the recognized VaultError %s without retaining its payload", async (code) => {
    const vaultRoot = await createTempVault();
    const capture = await addGeneratedCapture({
      lookupKey: "generated:blocked-code",
      recordedAt: "2026-06-01T00:00:00.000Z",
      vaultRoot,
    });
    const attachmentRef = capture.event.attachments![0]!.relativePath;
    const now = new Date("2026-07-15T00:00:00.000Z");
    const result = await runGeneratedImageCaptureRetention({
      materializeCandidatePaths: async (storedPaths) => {
        if (storedPaths.includes(attachmentRef)) {
          throw new VaultError(code, "synthetic private error detail", {
            eventId: capture.eventId,
            relativePath: attachmentRef,
          });
        }
      },
      now,
      vaultRoot,
    });
    expect(result).toEqual({
      blockedCaptureCount: 1,
      blockedCaptureCounts: { ...emptyBlockedCaptureCounts, [code]: 1 },
      hasMoreEligibleCaptures: false,
      nextEligibleAt: "2026-07-16T00:00:00.000Z",
      retiredByteCount: 0,
      retiredCaptureCount: 0,
      scannedCaptureCount: 1,
    });
    await expect(readFile(path.join(vaultRoot, attachmentRef), "utf8"))
      .resolves.toBe("image:generated:blocked-code");
    // Counts belong to one pass, not the vault or a prior result.
    await expect(runGeneratedImageCaptureRetention({ now, vaultRoot }))
      .resolves.toMatchObject({
        blockedCaptureCount: 0,
        blockedCaptureCounts: emptyBlockedCaptureCounts,
        nextEligibleAt: null,
        retiredCaptureCount: 1,
      });
  });

  it.each([
    new Error("synthetic unexpected failure"),
    new VaultError("GENERATED_IMAGE_RETENTION_LOOKUP_INVALID", "synthetic lookup failure"),
    new VaultError("__proto__", "synthetic unknown code"),
    { code: "GENERATED_IMAGE_RETENTION_EVENT_MISSING", message: "not a VaultError" },
  ])("propagates an unrecognized error unchanged (%#)", async (error) => {
    const vaultRoot = await createTempVault();
    const capture = await addGeneratedCapture({
      lookupKey: "generated:unknown-error",
      recordedAt: "2026-06-01T00:00:00.000Z",
      vaultRoot,
    });
    const attachmentRef = capture.event.attachments![0]!.relativePath;
    await expect(runGeneratedImageCaptureRetention({
      materializeCandidatePaths: async (storedPaths) => {
        if (storedPaths.includes(attachmentRef)) {
          throw error;
        }
      },
      now: new Date("2026-07-15T00:00:00.000Z"),
      vaultRoot,
    })).rejects.toBe(error);
    await expect(readFile(path.join(vaultRoot, attachmentRef), "utf8"))
      .resolves.toBe("image:generated:unknown-error");
  });

  it("keeps abort precedence over recognized errors and aborts before materialization", async () => {
    const vaultRoot = await createTempVault();
    const capture = await addGeneratedCapture({
      lookupKey: "generated:aborted",
      recordedAt: "2026-06-01T00:00:00.000Z",
      vaultRoot,
    });
    const attachmentRef = capture.event.attachments![0]!.relativePath;
    const controller = new AbortController();
    const reason = new Error("synthetic retention abort");
    const materializeCandidatePaths = vi.fn(async (storedPaths: readonly string[]) => {
      if (storedPaths.includes(attachmentRef)) {
        controller.abort(reason);
        throw new VaultError("GENERATED_IMAGE_RETENTION_PRECONDITION_FAILED", "synthetic failure");
      }
    });
    const input = {
      materializeCandidatePaths,
      now: new Date("2026-07-15T00:00:00.000Z"),
      signal: controller.signal,
      vaultRoot,
    };
    await expect(runGeneratedImageCaptureRetention(input)).rejects.toBe(reason);
    expect(materializeCandidatePaths).toHaveBeenCalledTimes(2);
    materializeCandidatePaths.mockClear();
    await expect(runGeneratedImageCaptureRetention(input)).rejects.toBe(reason);
    expect(materializeCandidatePaths).not.toHaveBeenCalled();
    await expect(readFile(path.join(vaultRoot, attachmentRef), "utf8"))
      .resolves.toBe("image:generated:aborted");
  });
});
