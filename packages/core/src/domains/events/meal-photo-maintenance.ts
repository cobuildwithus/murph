import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eventRecordSchema, INBOX_IMAGE_RETENTION_WINDOW_MS, type EventRecord } from "@murphai/contracts";
import { isVaultError } from "../../errors.ts";
import { emitAuditRecord } from "../../audit.ts";
import { listEventLedgerShardPaths, readEventLedgerShardRecords } from "../../event-ledger-storage.ts";
import { buildEventSpineLifecycle, compareEventSpineEntries, eventSpineRevision } from "../../history/event-spine.ts";
import { withCanonicalWriteLock } from "../../operations/canonical-write-lock.ts";
import { describeRawArtifact } from "../../operations/raw-manifests.ts";
import { resolveVaultPathOnDisk } from "../../path-safety.ts";
import { runLoadedCanonicalWrite } from "../shared.ts";
import { toEventLedgerFile } from "./ledger.ts";
import { loadPhotoManifestSnapshot, stageMealPhotoRetirement } from "./meal-photo-files.ts";

type Meal = Extract<EventRecord, { kind: "meal" }>;
export interface MealPhotoMaintenanceInput {
  vaultRoot: string;
  now?: Date;
  maxMeals?: number;
  signal?: AbortSignal | null;
  protectedStoredPaths?: readonly string[];
  materializeCandidatePaths?: ((paths: readonly string[]) => Promise<unknown>) | null;
}
export interface MealPhotoMaintenanceResult {
  thumbnailCount: number;
  retiredPhotoCount: number;
  blockedMealCount: number;
  hasMore: boolean;
  nextEligibleAt: string | null;
}

/** Bounded, idempotent backfill and retention under the canonical write owner. */
export async function runMealPhotoMaintenance(input: MealPhotoMaintenanceInput): Promise<MealPhotoMaintenanceResult> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("Meal photo maintenance requires a valid time.");
  const limit = input.maxMeals ?? 10;
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new TypeError("Meal photo batch must be between zero and 100.");
  return withCanonicalWriteLock(input.vaultRoot, async () => {
    const result: MealPhotoMaintenanceResult = { thumbnailCount: 0, retiredPhotoCount: 0, blockedMealCount: 0, hasMore: false, nextEligibleAt: null };
    const meals = await latestMeals(input);
    let processed = 0;
    for (const record of meals) {
      input.signal?.throwIfAborted();
      const photos = fullPhotos(record);
      if (!photos.length) continue;
      try {
        const manifest = await loadPhotoManifestSnapshot({ vaultRoot: input.vaultRoot, mealId: record.mealId, attachmentPath: photos[0]!.relativePath });
        // App capture provenance is immutable. Other legacy photos use original import time, never editable meal time.
        const capturedAt = mealCaptureTime(record, manifest.manifest);
        const deadline = new Date(Date.parse(capturedAt) + INBOX_IMAGE_RETENTION_WINDOW_MS).toISOString();
        const expired = record.lifecycle?.state === "deleted" || Date.parse(deadline) <= now.getTime();
        if (!expired) result.nextEligibleAt = earliest(result.nextEligibleAt, deadline);
        if (record.photoThumbnail && !expired) continue;
        const attemptedAt = manifest.manifest.provenance.mealThumbnailAttemptedAt;
        if (!expired && typeof attemptedAt === "string" && Date.parse(attemptedAt) + 86_400_000 > now.getTime()) {
          result.nextEligibleAt = earliest(result.nextEligibleAt, new Date(Date.parse(attemptedAt) + 86_400_000).toISOString());
          continue;
        }
        if (photos.some(photo => input.protectedStoredPaths?.includes(photo.relativePath))) {
          result.blockedMealCount += 1;
          continue;
        }
        if (processed >= limit) { result.hasMore = true; continue; }
        processed += 1;
        input.signal?.throwIfAborted();
        const outcome = await maintainMeal({ input, record, capturedAt, expired, manifest, now });
        result.blockedMealCount += outcome.blockedMealCount;
        result.thumbnailCount += outcome.thumbnailCount;
        result.retiredPhotoCount += outcome.retiredPhotoCount;
      } catch (error) {
        input.signal?.throwIfAborted();
        if (!isMissingPhotoManifest(error)) throw error;
        // An unavailable historical manifest must not starve other meals.
        result.blockedMealCount += 1;
      }
    }
    if (result.blockedMealCount) result.nextEligibleAt = earliest(result.nextEligibleAt, new Date(now.getTime() + 86_400_000).toISOString());
    return result;
  });
}

async function maintainMeal(input: {
  input: MealPhotoMaintenanceInput;
  record: Meal;
  capturedAt: string;
  expired: boolean;
  manifest: Awaited<ReturnType<typeof loadPhotoManifestSnapshot>>;
  now: Date;
}) {
  const { record, manifest, now } = input;
  const photos = fullPhotos(record);
  const photo = photos[0]!;
  let thumbnail: { data: Buffer; width: number; height: number } | null = null;
  if (!record.photoThumbnail && record.lifecycle?.state !== "deleted") {
    await input.input.materializeCandidatePaths?.(photos.map(photo => photo.relativePath));
    input.input.signal?.throwIfAborted();
    try {
      thumbnail = await createThumbnail(input.input.vaultRoot, photo);
    } catch {
      // Retry missing/unsupported input later, but never extend full-photo retention.
      manifest.manifest.provenance.mealThumbnailAttemptedAt = now.toISOString();
    }
  }
  input.input.signal?.throwIfAborted();
  return runLoadedCanonicalWrite({ vaultRoot: input.input.vaultRoot, operationType: "meal_photo_maintenance",
    summary: "Maintain private meal photo", occurredAt: now,
    mutate: async ({ batch }) => {
      const next: Meal = structuredClone(record);
      next.photoCapturedAt = input.capturedAt;
      if (thumbnail) {
        // Older hosted writers uploaded before receipt acknowledgement; rollback
        // cleanup could permanently retire that identity. Fresh batches avoid
        // those tombstones, while receipt replay keeps the committed path.
        const relativePath = path.posix.join(path.posix.dirname(photo.relativePath), `thumbnail-v2-${batch.operationId}.jpg`);
        const raw = await batch.stageRawBytes({ targetRelativePath: relativePath, originalFileName: "meal-thumbnail.jpg", mediaType: "image/jpeg", content: thumbnail.data, allowExistingMatch: true });
        const artifact = await describeRawArtifact(raw, "photo_thumbnail");
        manifest.manifest.artifacts.push(artifact);
        next.attachments = [...(next.attachments ?? []), { role: "photo_thumbnail", kind: "photo", relativePath,
          originalFileName: artifact.originalFileName, mediaType: artifact.mediaType, sha256: artifact.sha256 }];
        next.rawRefs = [...new Set([...(next.rawRefs ?? []), relativePath])];
        next.photoThumbnail = { relativePath, sha256: artifact.sha256, byteSize: artifact.byteSize, width: thumbnail.width, height: thumbnail.height };
      }
      if (input.expired) {
        const retired = new Set(photos.map(a => a.relativePath));
        for (const relativePath of retired) await stageMealPhotoRetirement(batch, manifest.manifest, relativePath, now, "meal_photo_retention");
        next.attachments = next.attachments?.filter(a => !retired.has(a.relativePath));
        next.rawRefs = next.rawRefs?.filter(ref => !retired.has(ref));
      }
      next.recordedAt = now.toISOString();
      next.lifecycle = buildEventSpineLifecycle(eventSpineRevision(record) + 1, record.lifecycle?.state);
      if (record.lifecycle?.state === "deleted") delete next.photoThumbnail;
      const validated = eventRecordSchema.parse(next);
      const ledgerFile = toEventLedgerFile(next.occurredAt);
      await batch.stageTextWrite(manifest.relativePath, `${JSON.stringify(manifest.manifest, null, 2)}\n`, {
        allowRaw: true, overwrite: true, expectedTargetReceipt: { byteLength: manifest.integrity.byteSize, sha256: manifest.integrity.sha256 },
      });
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(validated)}\n`);
      await emitAuditRecord({ vaultRoot: input.input.vaultRoot, batch, action: "event_upsert", commandName: "core.runMealPhotoMaintenance",
        summary: "Maintained private meal photo retention.", occurredAt: now, files: [ledgerFile, manifest.relativePath], targetIds: [record.id, record.mealId] });
      return { blockedMealCount: !thumbnail && !record.photoThumbnail && record.lifecycle?.state !== "deleted" ? 1 : 0, thumbnailCount: thumbnail ? 1 : 0, retiredPhotoCount: input.expired ? photos.length : 0 };
    } });
}

function fullPhotos(record: Meal) {
  return (record.attachments ?? []).filter(a => a.kind === "photo" && (record.lifecycle?.state === "deleted" || a.role !== "photo_thumbnail"));
}
function isMissingPhotoManifest(error: unknown): boolean {
  return isVaultError(error) && error.code === "MEAL_PHOTO_RETENTION_MANIFEST_INVALID";
}
function mealCaptureTime(record: Meal, manifest: Awaited<ReturnType<typeof loadPhotoManifestSnapshot>>["manifest"]): string {
  return record.photoCapturedAt ?? originalCaptureTime(manifest.provenance.photoCapturedAt
    ?? (record.externalRef?.system === "meal-photo-capture" ? manifest.provenance.occurredAt : undefined), manifest.importedAt);
}
function originalCaptureTime(occurredAt: unknown, importedAt: string): string {
  return typeof occurredAt === "string" && Number.isFinite(Date.parse(occurredAt)) ? occurredAt : importedAt;
}
function earliest(left: string | null, right: string) { return left === null || right < left ? right : left; }
async function latestMeals(input: MealPhotoMaintenanceInput): Promise<Meal[]> {
  const latest = new Map<string, { relativePath: string; record: Meal }>();
  for (const relativePath of await listEventLedgerShardPaths(input.vaultRoot)) {
    input.signal?.throwIfAborted();
    for (const raw of await readEventLedgerShardRecords({ vaultRoot: input.vaultRoot, relativePath })) {
      const parsed = eventRecordSchema.safeParse(raw);
      if (!parsed.success || parsed.data.kind !== "meal") continue;
      const candidate = { relativePath, record: parsed.data };
      const prior = latest.get(candidate.record.id);
      if (!prior || compareEventSpineEntries(candidate, prior) > 0) latest.set(candidate.record.id, candidate);
    }
  }
  return [...latest.values()].map(entry => entry.record).sort((a, b) => a.id.localeCompare(b.id));
}

async function createThumbnail(vaultRoot: string, photo: NonNullable<Meal["attachments"]>[number]) {
  const resolved = await resolveVaultPathOnDisk(vaultRoot, photo.relativePath);
  const bytes = await readFile(resolved.absolutePath);
  if (createHash("sha256").update(bytes).digest("hex") !== photo.sha256) throw new Error("Meal photo integrity mismatch.");
  const { default: sharp } = await import("sharp");
  // Sharp strips EXIF/GPS by default; orient before resizing and never copy metadata.
  const output = await sharp(bytes, { limitInputPixels: 100_000_000 }).rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
  return { data: output.data, width: output.info.width, height: output.info.height };
}
