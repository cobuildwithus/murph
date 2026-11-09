import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { EventRecord } from "@murphai/contracts";
import { eventSpineRevision, isDeletedEventSpineRecord } from "../../history/event-spine.ts";
import { resolveVaultPathOnDisk } from "../../path-safety.ts";
import { upsertEvent } from "./ledger.ts";
import { latestMeals } from "./meal-photo-maintenance.ts";

type Meal = Extract<EventRecord, { kind: "meal" }>;
type PhotoPrint = Float64Array;

// A message photo is saved after it was taken; the slack covers clock skew.
const SAVED_BEFORE_CAPTURE_MS = 10 * 60_000;
const SAVED_AFTER_CAPTURE_MS = 24 * 60 * 60_000;
const MAX_CANDIDATES = 8;
const PRINT_SIDE = 32;
const BLOCK_SIDE = 4;
// Re-encoding, resizing and tone changes stay under 0.1; a different item in
// about 1% of the frame, or a second handheld shot, goes over 0.19.
const MAX_BLOCK_DIFFERENCE = 0.12;

export interface LinkUploadToMealWithSamePhotoInput {
  vaultRoot: string;
  uploadId: string;
  capturedAt: string;
  jpeg: Uint8Array;
  /**
   * Makes a vault file local: true when its bytes are on disk, false when they
   * are gone for good. Throws when that can't be known yet. Without it, files
   * are read from disk as they are.
   */
  materialize?: ((relativePath: string) => Promise<boolean>) | null;
  signal?: AbortSignal | null;
}

/**
 * The phone's automatic capture of a photo Murph already saved on a meal from a
 * message belongs to that meal: it gets the upload's id instead of a second
 * meal being made. Returns that meal's id, or null when no meal holds the
 * photo. A miss only costs today's duplicate, so anything unreadable is passed.
 */
export async function linkUploadToMealWithSamePhoto(
  input: LinkUploadToMealWithSamePhotoInput,
): Promise<string | null> {
  const capturedAt = Date.parse(input.capturedAt);
  if (!Number.isFinite(capturedAt)) throw new TypeError("A meal photo capture time is required.");
  const meals = await liveMeals(input);
  const linked = mealHoldingUpload(meals, input.uploadId);
  if (linked) return linked;
  const candidates = meals
    .filter(meal => holdsMessagePhotoSavedAfter(meal, capturedAt))
    .sort((left, right) => Date.parse(right.photoCapturedAt!) - Date.parse(left.photoCapturedAt!))
    .slice(0, MAX_CANDIDATES);
  if (!candidates.length) return null;
  const upload = await photoPrint(input.jpeg);
  if (!upload) return null;
  for (const meal of candidates) {
    input.signal?.throwIfAborted();
    const bytes = await readMealPhoto(input, mealPhoto(meal)!);
    const print = bytes && await photoPrint(bytes);
    if (!print || !samePhoto(upload, print)) continue;
    const payload: Record<string, unknown> = structuredClone(meal);
    delete payload.lifecycle;
    payload.uploadId = input.uploadId;
    payload.recordedAt = new Date().toISOString();
    // A meal edited since it was read fails the revision check and is retried.
    await upsertEvent({
      vaultRoot: input.vaultRoot,
      payload,
      allowSpecializedKindRewrite: true,
      expectedRevision: eventSpineRevision(meal),
    });
    return meal.mealId;
  }
  return null;
}

/** The live meal that already holds this upload: replays recognize their meal by it once staging is gone. */
export async function findMealHoldingUpload(input: {
  vaultRoot: string;
  uploadId: string;
  signal?: AbortSignal | null;
}): Promise<string | null> {
  return mealHoldingUpload(await liveMeals(input), input.uploadId);
}

async function liveMeals(input: { vaultRoot: string; signal?: AbortSignal | null }): Promise<Meal[]> {
  return (await latestMeals(input)).filter(meal => !isDeletedEventSpineRecord(meal));
}

function mealHoldingUpload(meals: readonly Meal[], uploadId: string): string | null {
  return meals.find(meal => meal.uploadId === uploadId)?.mealId ?? null;
}

function holdsMessagePhotoSavedAfter(meal: Meal, capturedAt: number): boolean {
  if (meal.uploadId || meal.externalRef?.system === "meal-photo-capture" || !mealPhoto(meal)) return false;
  const savedAt = Date.parse(meal.photoCapturedAt ?? "");
  return savedAt >= capturedAt - SAVED_BEFORE_CAPTURE_MS && savedAt <= capturedAt + SAVED_AFTER_CAPTURE_MS;
}

function mealPhoto(meal: Meal): { relativePath: string; sha256: string } | undefined {
  return meal.photoThumbnail
    ?? meal.attachments?.find(attachment => attachment.kind === "photo" && attachment.role === "photo");
}

async function readMealPhoto(
  input: LinkUploadToMealWithSamePhotoInput,
  photo: { relativePath: string; sha256: string },
): Promise<Uint8Array | null> {
  if (input.materialize && !await input.materialize(photo.relativePath)) return null;
  try {
    const resolved = await resolveVaultPathOnDisk(input.vaultRoot, photo.relativePath);
    const bytes = await readFile(resolved.absolutePath);
    return createHash("sha256").update(bytes).digest("hex") === photo.sha256 ? bytes : null;
  } catch {
    return null;
  }
}

/** A small grayscale copy, normalized so brightness and contrast don't count. Null when it can't decode or is flat. */
async function photoPrint(bytes: Uint8Array): Promise<PhotoPrint | null> {
  try {
    const { default: sharp } = await import("sharp");
    const { data } = await sharp(bytes, { limitInputPixels: 100_000_000 }).rotate()
      .resize(PRINT_SIDE, PRINT_SIDE, { fit: "fill" }).grayscale().raw().toBuffer({ resolveWithObject: true });
    const values = Float64Array.from(data);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    return deviation < 1 ? null : values.map(value => (value - mean) / deviation);
  } catch {
    return null;
  }
}

/** The same photo agrees in every region, not only on average. */
function samePhoto(left: PhotoPrint, right: PhotoPrint): boolean {
  for (let blockY = 0; blockY < PRINT_SIDE; blockY += BLOCK_SIDE) {
    for (let blockX = 0; blockX < PRINT_SIDE; blockX += BLOCK_SIDE) {
      let difference = 0;
      for (let y = blockY; y < blockY + BLOCK_SIDE; y += 1) {
        for (let x = blockX; x < blockX + BLOCK_SIDE; x += 1) {
          difference += Math.abs(left[y * PRINT_SIDE + x]! - right[y * PRINT_SIDE + x]!);
        }
      }
      if (difference / (BLOCK_SIDE * BLOCK_SIDE) > MAX_BLOCK_DIFFERENCE) return false;
    }
  }
  return true;
}
