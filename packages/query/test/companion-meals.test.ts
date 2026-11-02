import { expect, it } from "vitest";
import { createVaultReadModel, type CanonicalEntity } from "../src/index.ts";
import { buildCompanionMealsProjection } from "../src/browser-replica/meals.ts";
import { createBrowserVaultReplica } from "../src/browser-replica/build.ts";
import { parseBrowserVaultReplica, parseBrowserVaultCoreShard } from "../src/browser-replica/parse.ts";
import { splitBrowserVaultReplica, assembleBrowserVaultCoreReplica } from "../src/browser-replica/shards.ts";

function meal(id: string, at: string, totals: Record<string, number> = {}): CanonicalEntity {
  return {
    entityId: id, primaryLookupId: id, lookupIds: [id], family: "event", recordClass: "ledger",
    kind: "meal", status: "active", occurredAt: at, date: at.slice(0, 10),
    path: `ledger/events/${id}.jsonl`, title: "Meal", body: null,
    attributes: { mealId: id, note: "Synthetic grain bowl", nutrition: { totals } },
    frontmatter: null, links: [], relatedIds: [], stream: null, experimentSlug: null, tags: [],
  };
}

it("groups full local days across DST with sparse totals and stable newest ordering", () => {
  const projection = buildCompanionMealsProjection(createVaultReadModel({
    vaultRoot: "browser://fixture", metadata: { timezone: "America/New_York" }, entities: [
      meal("meal_a", "2026-11-01T05:30:00Z", { calories: 400, proteinGrams: 20 }),
      meal("meal_b", "2026-11-01T06:30:00Z", { calories: 300, fatGrams: 0 }),
      meal("meal_c", "2026-11-01T03:30:00Z"),
      meal("meal_d", "2026-11-01T07:00:00Z"),
    ],
  }));
  expect(projection?.timeZone).toBe("America/New_York");
  expect(projection?.days.map(day => day.date)).toEqual(["2026-11-01", "2026-10-31"]);
  expect(projection?.days[0]).toMatchObject({ calories: 700, proteinGrams: 20, carbsGrams: null, fatGrams: 0, mealCount: 3, calorieMealCount: 2 });
  expect(projection?.days[0]?.meals.map(meal => meal.id)).toEqual(["meal_d", "meal_b", "meal_a"]);
  expect(projection?.days[1]).toMatchObject({ calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null });
  expect(projection?.days[0]?.meals[0]).toEqual({
    id: "meal_d", eatenAt: "2026-11-01T07:00:00Z", name: "Synthetic grain bowl",
    calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null, uploadId: null,
  });
});

it("does not invent a timezone or estimates and preserves a real empty projection", () => {
  const vault = createVaultReadModel({ vaultRoot: "browser://fixture", entities: [] });
  expect(buildCompanionMealsProjection(vault)).toBeUndefined();
  vault.metadata = { timezone: "invalid" };
  expect(buildCompanionMealsProjection(vault)).toBeUndefined();
  vault.metadata = { timezone: "UTC" };
  expect(buildCompanionMealsProjection(vault)).toEqual({ schemaVersion: 1, timeZone: "UTC", days: [] });
});

it("retains structured meals through full and core-only encrypted replica payloads", async () => {
  const vault = createVaultReadModel({ vaultRoot: "browser://fixture", metadata: { timezone: "Asia/Tokyo" }, entities: [meal("meal_a", "2026-10-31T23:30:00Z", { calories: 500 })] });
  const replica = await createBrowserVaultReplica({ vault, metricPoints: [], generatedAt: "2026-11-01T01:00:00Z", sourceBundleHash: "a".repeat(64) });
  expect(replica.meals?.days[0]?.date).toBe("2026-11-01");
  expect(parseBrowserVaultReplica(JSON.parse(JSON.stringify(replica))).meals).toEqual(replica.meals);
  const shards = await splitBrowserVaultReplica(replica);
  expect(assembleBrowserVaultCoreReplica(parseBrowserVaultCoreShard(JSON.parse(JSON.stringify(shards.core)))).meals).toEqual(replica.meals);
});


it("projects only explicit upload links, preserving them through encrypted core shards", async () => {
  const uploaded = meal("meal_upload", "2026-11-01T12:00:00Z");
  uploaded.attributes.uploadId = "2f1c1fdc-c7b0-4d90-b902-8e6295959243";
  const legacy = meal("meal_legacy", "2026-11-01T11:00:00Z");
  legacy.attributes.externalRef = { system: "meal-photo-capture", resourceId: "a".repeat(64) };
  const vault = createVaultReadModel({ vaultRoot: "browser://fixture", metadata: { timezone: "UTC" }, entities: [uploaded, legacy, meal("meal_typed", "2026-11-01T10:00:00Z")] });
  const replica = await createBrowserVaultReplica({ vault, metricPoints: [], generatedAt: "2026-11-01T13:00:00Z", sourceBundleHash: "a".repeat(64) });
  const shards = await splitBrowserVaultReplica(replica);
  const decoded = assembleBrowserVaultCoreReplica(parseBrowserVaultCoreShard(JSON.parse(JSON.stringify(shards.core))));
  expect(decoded.meals?.days[0]?.meals.map(value => value.uploadId)).toEqual([uploaded.attributes.uploadId, null, null]);
});

it.each([
  [{ title: "Salmon rice bowl", note: "Large serving from a cafe; portion uncertain" }, "Salmon rice bowl"],
  [{ title: "Meal", note: "Lunch: Estimated lentil soup; two cups" }, "lentil soup"],
  [{ note: "Photo shows baked tofu - portion uncertain" }, "baked tofu"],
  [{ note: "Snack: Retained image reviewed: apple slices; small plate" }, "apple slices"],
  [{ note: "breakfast: Photo shows porridge" }, "porridge"],
  [{ note: "Dinner: Estimated; no useful identity" }, null],
  [{ title: "Meal", note: "  " }, null],
  [{ title: "Meal", mealName: "Estimated noodle soup - one bowl" }, "noodle soup"],
  [{ title: "Meal", note: "x".repeat(130) }, `${"x".repeat(119)}…`],
])("prefers canonical dish names and cleans legacy labels without mutating meals: %j", (attributes, expected) => {
  const record = meal("meal_name", "2026-11-01T12:00:00Z", { calories: 620, proteinGrams: 28 });
  Object.assign(record.attributes, attributes);
  record.attributes.uploadId = "synthetic-capture";
  const before = structuredClone(record);
  const projection = buildCompanionMealsProjection(createVaultReadModel({
    vaultRoot: "browser://fixture", metadata: { timezone: "UTC" }, entities: [record],
  }));
  expect(projection?.days[0]?.meals[0]).toMatchObject({ name: expected, calories: 620, proteinGrams: 28, uploadId: "synthetic-capture" });
  expect(projection?.days[0]).toMatchObject({ calories: 620, proteinGrams: 28, mealCount: 1 });
  expect(record).toEqual(before);
});

it("carries exact capture provenance in encrypted core entities for legacy link recovery", async () => {
  const record = meal("meal_legacy", "2026-11-01T11:00:00Z");
  Object.assign(record.attributes, {
    source: "device",
    externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: "a".repeat(64) },
    rawRefs: ["private/photo.jpg"],
  });
  const vault = createVaultReadModel({ vaultRoot: "browser://fixture", metadata: { timezone: "UTC" }, entities: [record] });
  const replica = await createBrowserVaultReplica({ vault, metricPoints: [], generatedAt: "2026-11-01T13:00:00Z", sourceBundleHash: "a".repeat(64) });
  const shards = await splitBrowserVaultReplica(replica);
  const decoded = assembleBrowserVaultCoreReplica(parseBrowserVaultCoreShard(JSON.parse(JSON.stringify(shards.core))));
  expect(decoded.entities[0]?.attributes).toEqual({
    mealId: "meal_legacy", source: "device", externalRef: record.attributes.externalRef,
  });
  expect(decoded.meals?.days[0]?.meals[0]?.uploadId).toBeNull();
});

it("preserves private thumbnail metadata through the encrypted core projection", async () => {
  const record = meal("meal_photo", "2026-11-01T12:00:00Z");
  const thumbnail = { relativePath: "raw/meals/2026/11/meal_photo/thumbnail.jpg", sha256: "c".repeat(64), byteSize: 60000, width: 640, height: 480 };
  record.attributes.photoThumbnail = thumbnail;
  const vault = createVaultReadModel({ vaultRoot: "browser://fixture", metadata: { timezone: "UTC" }, entities: [record] });
  const replica = await createBrowserVaultReplica({ vault, metricPoints: [], generatedAt: "2026-11-01T13:00:00Z", sourceBundleHash: "a".repeat(64) });
  const shards = await splitBrowserVaultReplica(replica);
  const decoded = assembleBrowserVaultCoreReplica(parseBrowserVaultCoreShard(JSON.parse(JSON.stringify(shards.core))));
  expect(decoded.meals?.days[0]?.meals[0]?.thumbnail).toEqual(thumbnail);
});
