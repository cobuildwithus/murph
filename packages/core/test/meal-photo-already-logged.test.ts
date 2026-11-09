import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";
import {
  addMeal,
  deleteEvent,
  initializeVault,
  linkUploadToMealWithSamePhoto,
  readEvent,
} from "../src/index.ts";

const capturedAt = "2026-07-01T12:00:00.000Z";
const savedAt = "2026-07-01T12:02:00.000Z";
const uploadId = "a".repeat(64);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** A detailed synthetic "photo": seeded shapes, so it is never flat. */
async function scene(seed: number): Promise<Buffer> {
  let state = seed;
  const random = () => { state = (state * 1_103_515_245 + 12_345) % 2_147_483_648; return state / 2_147_483_648; };
  const color = () => `rgb(${Math.floor(random() * 256)},${Math.floor(random() * 256)},${Math.floor(random() * 256)})`;
  const shapes = Array.from({ length: 40 }, () => random() < 0.5
    ? `<circle cx="${random() * 960}" cy="${random() * 720}" r="${20 + random() * 120}" fill="${color()}"/>`
    : `<rect x="${random() * 960}" y="${random() * 720}" width="${30 + random() * 200}" height="${30 + random() * 200}" fill="${color()}"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="960" height="720" fill="${color()}"/>${shapes.join("")}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function vaultWithTextedMeal(input: { photo?: Buffer; photoCapturedAt?: string; uploadId?: string; device?: boolean } = {}) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-meal-already-logged-"));
  roots.push(vaultRoot);
  await initializeVault({ vaultRoot, title: "Synthetic meal photos", timezone: "UTC" });
  const photoPath = path.join(vaultRoot, "texted.jpg");
  await writeFile(photoPath, input.photo ?? await scene(1));
  const time = input.photoCapturedAt ?? savedAt;
  const meal = await addMeal({
    vaultRoot, photoPath, photoCapturedAt: time, occurredAt: time, name: "Chicken rice bowl", note: "Texted lunch",
    source: input.device ? "device" : "manual",
    ...(input.uploadId ? { uploadId: input.uploadId } : {}),
    ...(input.device ? { externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: "b".repeat(64) } } : {}),
  });
  return { vaultRoot, meal };
}

it.each([
  ["re-encoded at quality 40", (photo: Buffer) => sharp(photo).jpeg({ quality: 40 }).toBuffer()],
  ["resized to 320 px", (photo: Buffer) => sharp(photo).resize(320).jpeg({ quality: 60 }).toBuffer()],
  ["brighter and more contrasty", (photo: Buffer) => sharp(photo).linear(1.1, -10).jpeg().toBuffer()],
])("links the phone's upload of a texted photo to its meal: %s", async (_name, phoneCopy) => {
  const { vaultRoot, meal } = await vaultWithTextedMeal();
  const jpeg = await phoneCopy(await scene(1));
  const before = (await readEvent({ vaultRoot, eventId: meal.event.id })).event;

  expect(await linkUploadToMealWithSamePhoto({ vaultRoot, uploadId, capturedAt, jpeg })).toBe(meal.mealId);
  const linked = (await readEvent({ vaultRoot, eventId: meal.event.id })).event;
  if (linked.kind !== "meal" || before.kind !== "meal") throw new Error("Expected meals");
  expect(linked.uploadId).toBe(uploadId);
  expect(linked.lifecycle?.revision).toBe((before.lifecycle?.revision ?? 1) + 1);
  const { uploadId: _uploadId, recordedAt: _recordedAt, lifecycle: _lifecycle, ...kept } = linked;
  const { recordedAt: _beforeRecordedAt, lifecycle: _beforeLifecycle, ...original } = before;
  expect(kept).toEqual(original);

  // A retried import finds the link and writes nothing more.
  expect(await linkUploadToMealWithSamePhoto({ vaultRoot, uploadId, capturedAt, jpeg })).toBe(meal.mealId);
  expect((await readEvent({ vaultRoot, eventId: meal.event.id })).event.lifecycle).toEqual(linked.lifecycle);
});

it.each([
  ["a different photo", {}, () => scene(2)],
  ["the same table with a different dish in the middle", {}, async () => {
    const dish = await sharp(await scene(3)).resize(192, 144).toBuffer();
    return sharp(await scene(1)).composite([{ input: dish, left: 384, top: 288 }]).jpeg().toBuffer();
  }],
  ["a second handheld shot", {}, async () => sharp(await scene(1)).extract({ left: 29, top: 0, width: 902, height: 720 }).jpeg().toBuffer()],
  ["a flat image", {}, () => sharp({ create: { width: 64, height: 64, channels: 3, background: "#ffffff" } }).jpeg().toBuffer()],
  ["a meal saved 11 minutes before the photo was taken", { photoCapturedAt: "2026-07-01T11:49:00.000Z" }, () => scene(1)],
  ["a meal saved 25 hours after", { photoCapturedAt: "2026-07-02T13:00:00.000Z" }, () => scene(1)],
  ["a meal another upload already holds", { uploadId: "c".repeat(64) }, () => scene(1)],
  ["the phone's own earlier capture", { device: true }, () => scene(1)],
] as const)("leaves %s alone", async (_name, mealInput, upload) => {
  const { vaultRoot, meal } = await vaultWithTextedMeal(mealInput);
  const before = (await readEvent({ vaultRoot, eventId: meal.event.id })).event;
  expect(await linkUploadToMealWithSamePhoto({ vaultRoot, uploadId, capturedAt, jpeg: await upload() })).toBeNull();
  expect((await readEvent({ vaultRoot, eventId: meal.event.id })).event).toEqual(before);
});

it("passes a deleted meal and a photo that is gone or changed, and retries when it can't tell", async () => {
  const jpeg = await scene(1);
  const deleted = await vaultWithTextedMeal();
  await deleteEvent({ vaultRoot: deleted.vaultRoot, eventId: deleted.meal.event.id });
  expect(await linkUploadToMealWithSamePhoto({ vaultRoot: deleted.vaultRoot, uploadId, capturedAt, jpeg })).toBeNull();

  const { vaultRoot, meal } = await vaultWithTextedMeal();
  const requested: string[] = [];
  const gone = async (relativePath: string) => { requested.push(relativePath); return false; };
  expect(await linkUploadToMealWithSamePhoto({ vaultRoot, uploadId, capturedAt, jpeg, materialize: gone })).toBeNull();
  expect(requested).toEqual([meal.photo!.relativePath]);

  const unknown = async () => { throw new Error("transfer failed"); };
  await expect(linkUploadToMealWithSamePhoto({ vaultRoot, uploadId, capturedAt, jpeg, materialize: unknown }))
    .rejects.toThrow("transfer failed");

  await writeFile(path.join(vaultRoot, meal.photo!.relativePath), await scene(2));
  expect(await linkUploadToMealWithSamePhoto({ vaultRoot, uploadId, capturedAt, jpeg })).toBeNull();
});
