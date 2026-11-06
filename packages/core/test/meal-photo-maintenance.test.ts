import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { INBOX_IMAGE_RETENTION_WINDOW_MS } from "@murphai/contracts";
import { addMeal, deleteEvent, initializeVault, readEvent, removeAutomaticMealPhoto, runMealPhotoMaintenance, validateVault } from "../src/index.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-meal-thumbnails-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot, title: "Synthetic meal photos", timezone: "UTC" });
  const photoPath = path.join(vaultRoot, "fixture.jpg");
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#446688" } })
    .withMetadata({ orientation: 6 }).jpeg().toFile(photoPath);
  return { vaultRoot, photoPath };
}
const capturedAt = "2026-07-01T12:00:00.000Z";
const due = new Date(Date.parse(capturedAt) + INBOX_IMAGE_RETENTION_WINDOW_MS);

it("backfills an oriented metadata-free JPEG, preserves it at day 90, and deletes meal media", async () => {
  const input = await fixture();
  const meal = await addMeal({ ...input, photoCapturedAt: capturedAt, occurredAt: capturedAt, note: "Synthetic fixture" });
  expect(await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: new Date(due.getTime() - 1) })).toMatchObject({ thumbnailCount: 1, retiredPhotoCount: 0, blockedMealCount: 0 });
  const current = (await readEvent({ vaultRoot: input.vaultRoot, eventId: meal.event.id })).event;
  if (current.kind !== "meal") throw new Error("Expected meal");
  expect(current.photoThumbnail).toMatchObject({ width: 427, height: 640 });
  const thumbnailPath = path.join(input.vaultRoot, current.photoThumbnail!.relativePath);
  const metadata = await sharp(await readFile(thumbnailPath)).metadata();
  expect(metadata).toMatchObject({ format: "jpeg", width: 427, height: 640 });
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  expect(await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: new Date(due.getTime() - 1) })).toMatchObject({ thumbnailCount: 0, retiredPhotoCount: 0 });
  const materializeCandidatePaths = vi.fn(async () => { throw new Error("Metadata-only retirement must not read images"); });
  expect(await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: due, materializeCandidatePaths })).toMatchObject({ thumbnailCount: 0, retiredPhotoCount: 1 });
  expect(materializeCandidatePaths).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(path.join(input.vaultRoot, meal.photo!.relativePath), "utf8"))).toMatchObject({ reason: "meal_photo_retention" });
  expect((await readFile(thumbnailPath)).length).toBeGreaterThan(0);
  await deleteEvent({ vaultRoot: input.vaultRoot, eventId: meal.event.id });
  expect(JSON.parse(await readFile(thumbnailPath, "utf8"))).toMatchObject({ reason: "meal_deleted" });
  expect(await validateVault({ vaultRoot: input.vaultRoot })).toMatchObject({ valid: true, issues: [] });
});

it("closeout marks review complete without destroying a photo or creating repeated work", async () => {
  const input = await fixture();
  const meal = await addMeal({ ...input, photoCapturedAt: capturedAt, occurredAt: capturedAt, source: "device", externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: "a".repeat(64) } });
  expect(await removeAutomaticMealPhoto({ vaultRoot: input.vaultRoot, eventId: meal.event.id })).toMatchObject({ removedPhotoCount: 1 });
  expect(await removeAutomaticMealPhoto({ vaultRoot: input.vaultRoot, eventId: meal.event.id })).toMatchObject({ removedPhotoCount: 0 });
  expect((await readFile(path.join(input.vaultRoot, meal.photo!.relativePath))).length).toBeGreaterThan(0);
  expect(await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: due })).toMatchObject({ thumbnailCount: 1, retiredPhotoCount: 1 });
});

it("bounds work and resumes past unavailable input, and never extends retention for invalid images", async () => {
  const input = await fixture();
  await addMeal({ ...input, photoCapturedAt: capturedAt, occurredAt: capturedAt });
  await writeFile(input.photoPath, "invalid historical image");
  const invalid = await addMeal({ ...input, photoCapturedAt: capturedAt, occurredAt: capturedAt });
  const before = new Date(due.getTime() - 1000);
  const first = await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: before, maxMeals: 1 });
  expect(first.hasMore).toBe(true);
  const second = await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: before, maxMeals: 1 });
  expect(first.thumbnailCount + second.thumbnailCount).toBe(1);
  expect(first.blockedMealCount + second.blockedMealCount).toBe(1);
  expect(await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: due })).toMatchObject({ retiredPhotoCount: 2 });
  expect(JSON.parse(await readFile(path.join(input.vaultRoot, invalid.photo!.relativePath), "utf8"))).toMatchObject({ reason: "meal_photo_retention" });
});

it("retires media left by historical hide-only deletion without reviving the meal", async () => {
  const input = await fixture();
  const meal = await addMeal({ ...input, photoCapturedAt: capturedAt, occurredAt: capturedAt });
  await appendFile(path.join(input.vaultRoot, meal.eventPath), `${JSON.stringify({ ...meal.event,
    recordedAt: "2026-07-02T12:00:00.000Z", lifecycle: { revision: 2, state: "deleted" } })}\n`);
  const materializeCandidatePaths = vi.fn(async () => { throw new Error("Deleted meal cleanup must not read images"); });
  expect(await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: new Date("2026-07-03T12:00:00Z"), materializeCandidatePaths }))
    .toMatchObject({ thumbnailCount: 0, retiredPhotoCount: 1, blockedMealCount: 0 });
  expect(JSON.parse(await readFile(path.join(input.vaultRoot, meal.photo!.relativePath), "utf8")))
    .toMatchObject({ reason: "meal_photo_retention" });
  expect(await runMealPhotoMaintenance({ vaultRoot: input.vaultRoot, now: due }))
    .toMatchObject({ thumbnailCount: 0, retiredPhotoCount: 0 });
  expect(materializeCandidatePaths).not.toHaveBeenCalled();
  await expect(readEvent({ vaultRoot: input.vaultRoot, eventId: meal.event.id })).rejects.toMatchObject({ code: "EVENT_MISSING" });
  expect(await validateVault({ vaultRoot: input.vaultRoot })).toMatchObject({ valid: true, issues: [] });
});
