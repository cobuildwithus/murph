import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { addMeal, initializeVault, VaultError, withCanonicalWriteLock } from "@murphai/core";
import { beforeEach, expect, test, vi } from "vitest";

import { createHostedArtifactMaterializer } from "../src/hosted-runtime/artifacts.ts";
import { writeHostedMediaReferenceCatalogue } from "../src/hosted-runtime/media-references.ts";

// Only the lock boundary is simulated. A writer holding the lock past the
// 30-second timeout surfaces as this error, which is too slow to reach for real.
vi.mock("@murphai/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/core")>(),
  withCanonicalWriteLock: vi.fn(),
}));

const lock = vi.mocked(withCanonicalWriteLock);
beforeEach(() => {
  lock.mockReset();
  lock.mockRejectedValue(new VaultError("CANONICAL_WRITE_LOCKED", "Synthetic long canonical writer."));
});

async function setup(root: string) {
  await initializeVault({ vaultRoot: root, timezone: "UTC" });
  const photoPath = path.join(root, "source.png");
  const bytes = Buffer.from("synthetic photo");
  await writeFile(photoPath, bytes);
  const meal = await addMeal({ vaultRoot: root, photoPath, occurredAt: "2030-01-01T00:00:00Z" });
  const photo = meal.photo!.relativePath;
  const inbox = "raw/inbox/synthetic/photo.png";
  const descriptor = { mediaKind: "image" as const, mimeType: "image/png", byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), recordedAt: "2030-01-01T00:00:00.000Z", expiresAt: null };
  await writeHostedMediaReferenceCatalogue({ vaultRoot: root, catalogue: { schema: "murph.hosted-media-refs.v1", entries: [
    { ...descriptor, relativePath: inbox, mediaId: "a".repeat(64) },
    { ...descriptor, relativePath: photo, mediaId: "b".repeat(64) },
  ] } });
  await rm(path.join(root, photo));
  const materialize = createHostedArtifactMaterializer({ vaultRoot: root, operatorHomeRoot: root,
    mediaStore: { put: async () => {}, get: async () => bytes } });
  return { bytes, inbox, materialize, photo };
}

test("inbox reads on the foreground path never touch the canonical write lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-lock-inbox-"));
  try {
    const { bytes, inbox, materialize } = await setup(root);
    const result = await materialize([inbox]);
    expect([...result.materializedArtifactPaths]).toEqual([`vault:${inbox}`]);
    expect(await readFile(path.join(root, inbox))).toEqual(bytes);
    expect(lock).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a long canonical writer leaves a photo read retryable instead of aborting the turn", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-lock-photo-"));
  try {
    const { inbox, materialize, photo } = await setup(root);
    const result = await materialize([photo, inbox]);
    expect(Object.fromEntries(result.missingArtifactPaths)).toEqual({ [`vault:${photo}`]: "transport" });
    expect([...result.materializedArtifactPaths]).toEqual([`vault:${inbox}`]);
    await expect(stat(path.join(root, photo))).rejects.toMatchObject({ code: "ENOENT" });
    expect(lock).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lock failures other than a busy writer stay control flow", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "murph-media-lock-owner-"));
  try {
    const { materialize, photo } = await setup(root);
    const ownerLost = new Error("Synthetic owner lost");
    lock.mockRejectedValue(ownerLost);
    await expect(materialize([photo])).rejects.toMatchObject({ cause: ownerLost });
  } finally { await rm(root, { recursive: true, force: true }); }
});
