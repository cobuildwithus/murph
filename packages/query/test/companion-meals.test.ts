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
