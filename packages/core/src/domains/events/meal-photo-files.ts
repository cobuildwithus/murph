import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { rawImportManifestSchema, type EventRecord, type RawImportManifest } from "@murphai/contracts";
import { VaultError } from "../../errors.ts";
import { walkVaultFiles } from "../../fs.ts";
import { isRawManifestFileName } from "../../operations/raw-manifests.ts";
import type { WriteBatch } from "../../operations/write-batch.ts";
import { resolveVaultPathOnDisk } from "../../path-safety.ts";

interface ManifestSnapshot {
  integrity: { byteSize: number; sha256: string };
  manifest: RawImportManifest;
  relativePath: string;
}

/** Canonical privacy deletes also retire encrypted media through write receipts. */
export async function stageMealPhotoDeletion(vaultRoot: string, batch: WriteBatch, record: EventRecord, now: Date): Promise<void> {
  if (record.kind !== "meal") return;
  const photos = (record.attachments ?? []).filter(attachment => attachment.kind === "photo");
  const manifests = new Map<string, ManifestSnapshot>();
  for (const attachment of photos) {
    const snapshot = await loadPhotoManifestSnapshot({ vaultRoot, mealId: record.mealId, attachmentPath: attachment.relativePath });
    const owner = manifests.get(snapshot.relativePath) ?? snapshot;
    manifests.set(snapshot.relativePath, owner);
    await stageMealPhotoRetirement(batch, owner.manifest, attachment.relativePath, now, "meal_deleted");
  }
  for (const snapshot of manifests.values()) {
    await batch.stageTextWrite(snapshot.relativePath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`, {
      allowRaw: true, overwrite: true,
      expectedTargetReceipt: { byteLength: snapshot.integrity.byteSize, sha256: snapshot.integrity.sha256 },
    });
  }
}

/** Preserve append-only references with a metadata-only tombstone, never image bytes. */
export async function stageMealPhotoRetirement(
  batch: WriteBatch, manifest: RawImportManifest, relativePath: string,
  now: Date, reason: "meal_deleted" | "meal_photo_retention",
): Promise<void> {
  const artifact = manifest.artifacts.find(value => value.relativePath === relativePath);
  if (!artifact) throw new VaultError("MEAL_PHOTO_RETENTION_MANIFEST_INVALID", "Meal photo manifest artifact is missing.");
  const content = `${JSON.stringify({ schemaVersion: "murph.meal-photo-retention-tombstone.v1", purgedAt: now.toISOString(), reason })}\n`;
  await batch.stageTextWrite(relativePath, content, { allowRaw: true, overwrite: true });
  Object.assign(artifact, { byteSize: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex"),
    mediaType: "application/json", originalFileName: "meal-photo-retention-tombstone.json", role: "privacy_tombstone" });
}

export async function loadPhotoManifestSnapshot(input: {
  attachmentPath: string;
  mealId: string;
  vaultRoot: string;
}): Promise<ManifestSnapshot> {
  const rawDirectory = path.posix.dirname(input.attachmentPath);
  const manifestPaths = (await walkVaultFiles(input.vaultRoot, rawDirectory, {
    extension: ".json",
  })).filter(
    (relativePath) =>
      path.posix.dirname(relativePath) === rawDirectory &&
      isRawManifestFileName(path.posix.basename(relativePath)),
  );
  const matches: ManifestSnapshot[] = [];
  for (const relativePath of manifestPaths) {
    const absolutePath = await resolveVaultPathOnDisk(
      input.vaultRoot,
      relativePath,
    );
    const content = await fs.readFile(absolutePath.absolutePath, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      continue;
    }
    const parsed = rawImportManifestSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.importId !== input.mealId ||
      parsed.data.importKind !== "meal" ||
      parsed.data.owner.kind !== "meal" ||
      parsed.data.owner.id !== input.mealId ||
      parsed.data.rawDirectory !== rawDirectory ||
      !parsed.data.artifacts.some(
        (artifact) => artifact.relativePath === input.attachmentPath,
      )
    ) {
      continue;
    }
    matches.push({
      integrity: {
        byteSize: Buffer.byteLength(content, "utf8"),
        sha256: createHash("sha256").update(content).digest("hex"),
      },
      manifest: parsed.data,
      relativePath,
    });
  }
  if (matches.length !== 1) {
    throw new VaultError(
      "MEAL_PHOTO_RETENTION_MANIFEST_INVALID",
      "Automatic meal photo requires exactly one matching raw manifest.",
    );
  }
  return matches[0]!;
}
