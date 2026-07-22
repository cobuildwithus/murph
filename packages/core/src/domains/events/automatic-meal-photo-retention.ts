import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  collectEventRawReferencePaths,
  eventRecordSchema,
  rawImportManifestSchema,
  safeParseContract,
  type EventRecord,
  type RawImportManifest,
} from "@murphai/contracts";

import { emitAuditRecord } from "../../audit.ts";
import { VaultError } from "../../errors.ts";
import { walkVaultFiles } from "../../fs.ts";
import {
  buildEventSpineLifecycle,
  eventSpineRevision,
  isDeletedEventSpineRecord,
} from "../../history/event-spine.ts";
import { withCanonicalWriteLock } from "../../operations/canonical-write-lock.ts";
import { isRawManifestFileName } from "../../operations/raw-manifests.ts";
import { resolveVaultPathOnDisk } from "../../path-safety.ts";
import { statAndHashVaultFile } from "../../raw-artifact-integrity.ts";
import { compactObject, runLoadedCanonicalWrite } from "../shared.ts";
import {
  loadEventLedgerShardsById,
  selectLatestMatchedEvent,
  toEventLedgerFile,
} from "./ledger.ts";

type MealEventRecord = Extract<EventRecord, { kind: "meal" }>;

interface ManifestSnapshot {
  integrity: {
    byteSize: number;
    sha256: string;
  };
  manifest: RawImportManifest;
  relativePath: string;
}

interface PhotoTombstone {
  content: string;
  integrity: {
    byteSize: number;
    sha256: string;
  };
  originalIntegrity: {
    byteSize: number;
    sha256: string;
  };
  relativePath: string;
}

export interface RemoveAutomaticMealPhotoInput {
  eventId: string;
  now?: Date;
  vaultRoot: string;
}

export interface RemoveAutomaticMealPhotoResult {
  eventId: string;
  ledgerFile: string;
  removedPhotoCount: number;
}

export async function removeAutomaticMealPhoto(
  input: RemoveAutomaticMealPhotoInput,
): Promise<RemoveAutomaticMealPhotoResult> {
  return withCanonicalWriteLock(input.vaultRoot, () =>
    removeAutomaticMealPhotoLocked(input),
  );
}

async function removeAutomaticMealPhotoLocked(
  input: RemoveAutomaticMealPhotoInput,
): Promise<RemoveAutomaticMealPhotoResult> {
  const matchedShards = await loadEventLedgerShardsById(
    input.vaultRoot,
    input.eventId,
  );
  const latest = selectLatestMatchedEvent(matchedShards);
  if (!latest || isDeletedEventSpineRecord(latest.record)) {
    throw new VaultError(
      "EVENT_MISSING",
      `Event "${input.eventId}" was not found.`,
    );
  }
  if (latest.record.kind !== "meal") {
    throw new VaultError(
      "MEAL_PHOTO_RETENTION_KIND_INVALID",
      "Automatic meal photo removal requires a meal event.",
    );
  }
  assertAutomaticMealCapture(latest.record);

  const photoAttachments = (latest.record.attachments ?? []).filter(
    (attachment) => attachment.role === "photo" && attachment.kind === "photo",
  );
  if (photoAttachments.length === 0) {
    return {
      eventId: latest.record.id,
      ledgerFile: latest.relativePath,
      removedPhotoCount: 0,
    };
  }

  const now = input.now ?? new Date();
  const purgedAt = now.toISOString();
  const photoPaths = new Set(
    photoAttachments.map((attachment) => attachment.relativePath),
  );
  const remainingAttachments = (latest.record.attachments ?? []).filter(
    (attachment) => !photoPaths.has(attachment.relativePath),
  );
  const remainingRawRefs = (latest.record.rawRefs ?? []).filter(
    (relativePath) => !photoPaths.has(relativePath),
  );
  const nextRecord = parseMealEventRecord(
    compactObject({
      ...latest.record,
      attachments:
        remainingAttachments.length > 0 ? remainingAttachments : undefined,
      lifecycle: buildEventSpineLifecycle(
        eventSpineRevision(latest.record) + 1,
      ),
      rawRefs: remainingRawRefs.length > 0 ? remainingRawRefs : undefined,
      recordedAt: purgedAt,
    }),
  );
  const lingeringPhotoReference = collectEventRawReferencePaths(nextRecord).find(
    (relativePath) => photoPaths.has(relativePath),
  );
  if (lingeringPhotoReference) {
    throw new VaultError(
      "MEAL_PHOTO_RETENTION_REFERENCE_INVALID",
      "Automatic meal photo removal cannot leave another current raw reference to the image.",
    );
  }

  const manifestSnapshots = new Map<string, ManifestSnapshot>();
  const tombstones: PhotoTombstone[] = [];
  for (const attachment of photoAttachments) {
    const originalIntegrity = await statAndHashVaultFile(
      input.vaultRoot,
      attachment.relativePath,
    );
    if (
      !originalIntegrity ||
      originalIntegrity.sha256 !== attachment.sha256
    ) {
      throw new VaultError(
        "MEAL_PHOTO_RETENTION_PRECONDITION_FAILED",
        "Automatic meal photo bytes changed after canonical capture.",
      );
    }

    const manifestSnapshot = await loadPhotoManifestSnapshot({
      attachmentPath: attachment.relativePath,
      vaultRoot: input.vaultRoot,
    });
    const manifestArtifact = manifestSnapshot.manifest.artifacts.find(
      (artifact) => artifact.relativePath === attachment.relativePath,
    );
    if (
      !manifestArtifact ||
      manifestArtifact.byteSize !== originalIntegrity.byteSize ||
      manifestArtifact.sha256 !== originalIntegrity.sha256
    ) {
      throw new VaultError(
        "MEAL_PHOTO_RETENTION_MANIFEST_INVALID",
        "Automatic meal photo manifest no longer matches the retained image.",
      );
    }
    manifestSnapshots.set(manifestSnapshot.relativePath, manifestSnapshot);

    const content = `${JSON.stringify({
      schemaVersion: "murph.automatic-meal-photo-tombstone.v1",
      reason: "automatic_meal_closeout",
      purgedAt,
      originalByteSize: originalIntegrity.byteSize,
      originalSha256: originalIntegrity.sha256,
    }, null, 2)}\n`;
    const contentBytes = Buffer.from(content, "utf8");
    tombstones.push({
      content,
      integrity: {
        byteSize: contentBytes.byteLength,
        sha256: createHash("sha256").update(contentBytes).digest("hex"),
      },
      originalIntegrity,
      relativePath: attachment.relativePath,
    });
  }

  const manifestUpdates = new Map<string, RawImportManifest>();
  for (const tombstone of tombstones) {
    const snapshot = [...manifestSnapshots.values()].find((candidate) =>
      candidate.manifest.artifacts.some(
        (artifact) => artifact.relativePath === tombstone.relativePath,
      ),
    );
    if (!snapshot) {
      throw new VaultError(
        "MEAL_PHOTO_RETENTION_MANIFEST_INVALID",
        "Automatic meal photo manifest is missing.",
      );
    }
    const manifest =
      manifestUpdates.get(snapshot.relativePath) ??
      structuredClone(snapshot.manifest);
    manifestUpdates.set(snapshot.relativePath, manifest);
    const artifact = manifest.artifacts.find(
      (candidate) => candidate.relativePath === tombstone.relativePath,
    );
    if (!artifact) {
      throw new VaultError(
        "MEAL_PHOTO_RETENTION_MANIFEST_INVALID",
        "Automatic meal photo manifest artifact is missing.",
      );
    }
    artifact.byteSize = tombstone.integrity.byteSize;
    artifact.mediaType = "application/json";
    artifact.originalFileName = "meal-photo-retention-tombstone.json";
    artifact.role = "privacy_tombstone";
    artifact.sha256 = tombstone.integrity.sha256;
    manifest.provenance = {
      ...manifest.provenance,
      automaticMealPhotoRetention: {
        purgedAt,
        reason: "automatic_meal_closeout",
      },
    };
  }

  const ledgerFile = toEventLedgerFile(nextRecord.occurredAt);
  return runLoadedCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "automatic_meal_photo_remove",
    summary: `Remove retained automatic meal photo for ${nextRecord.mealId}`,
    occurredAt: now,
    mutate: async ({ batch }) => {
      for (const tombstone of tombstones) {
        await batch.stageTextWrite(tombstone.relativePath, tombstone.content, {
          allowRaw: true,
          expectedTargetReceipt: {
            byteLength: tombstone.originalIntegrity.byteSize,
            sha256: tombstone.originalIntegrity.sha256,
          },
          overwrite: true,
        });
      }
      for (const [manifestPath, manifest] of manifestUpdates) {
        const snapshot = manifestSnapshots.get(manifestPath);
        if (!snapshot) {
          throw new VaultError(
            "MEAL_PHOTO_RETENTION_MANIFEST_INVALID",
            "Automatic meal photo manifest snapshot is missing.",
          );
        }
        await batch.stageTextWrite(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          {
            allowRaw: true,
            expectedTargetReceipt: {
              byteLength: snapshot.integrity.byteSize,
              sha256: snapshot.integrity.sha256,
            },
            overwrite: true,
          },
        );
      }
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(nextRecord)}\n`);
      await emitAuditRecord({
        action: "event_upsert",
        batch,
        commandName: "core.removeAutomaticMealPhoto",
        files: [
          ledgerFile,
          ...tombstones.map((tombstone) => tombstone.relativePath),
          ...manifestUpdates.keys(),
        ],
        occurredAt: now,
        summary: `Removed ${tombstones.length} retained automatic meal photo(s).`,
        targetIds: [nextRecord.mealId, nextRecord.id],
        vaultRoot: input.vaultRoot,
      });

      return {
        eventId: nextRecord.id,
        ledgerFile,
        removedPhotoCount: tombstones.length,
      };
    },
  });
}

function assertAutomaticMealCapture(record: MealEventRecord): void {
  if (
    record.externalRef?.system !== "meal-photo-capture" ||
    record.externalRef.resourceType !== "photo"
  ) {
    throw new VaultError(
      "MEAL_PHOTO_RETENTION_SOURCE_INVALID",
      "Photo removal is limited to automatic meal-capture records.",
    );
  }
}

function parseMealEventRecord(value: unknown): MealEventRecord {
  const parsed = safeParseContract(eventRecordSchema, value);
  if (!parsed.success || parsed.data.kind !== "meal") {
    throw new VaultError(
      "EVENT_CONTRACT_INVALID",
      "Automatic meal photo removal produced an invalid meal revision.",
      parsed.success ? {} : { errors: parsed.errors },
    );
  }
  return parsed.data;
}

async function loadPhotoManifestSnapshot(input: {
  attachmentPath: string;
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
