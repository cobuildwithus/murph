import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { goalMetricTargetSchema } from "@murphai/contracts";
import { initializeVault, upsertGoal } from "@murphai/core";
import { describe, expect, it, vi } from "vitest";
import { resolveMealNutritionGoals } from "../src/meal-nutrition-goals.ts";
import { readMealNutritionTotals } from "../src/meal-nutrition.ts";
import type { CanonicalEntity } from "../src/canonical-entities.ts";
import * as source from "../src/vault-source.ts";

const date = "2026-07-30";
function target(metricKey = "dietary-calories", value = 1800, overrides: Record<string, unknown> = {}) {
  return { kind: "metric", targetId: metricKey, metricKey, comparator: "between", value, highValue: value,
    unit: metricKey === "dietary-calories" || metricKey === "calories" ? "kcal" : "g",
    evaluation: { kind: "selected-value" }, ...overrides };
}
function bundle() {
  return [target(), target("protein-grams", 140), target("carbs-grams", 190), target("fat-grams", 55), target("fiber-grams", 25)];
}
function goal(id: string, metricTargets = bundle(), overrides: Partial<CanonicalEntity> = {}): CanonicalEntity {
  return { entityId: id, primaryLookupId: id, lookupIds: [id], family: "goal", recordClass: "bank", kind: "goal",
    status: "active", occurredAt: null, date: null, path: `bank/goals/${id}.md`, title: "Synthetic goal", body: null,
    attributes: { window: { startAt: "2026-07-01" }, metricTargets }, frontmatter: null, links: [], relatedIds: [],
    stream: null, experimentSlug: null, tags: [], ...overrides };
}
function historical(rolling = false) {
  const ids = ["daily-calories", "daily-protein", "daily-carbohydrates", "daily-fat", "daily-fiber"];
  return bundle().map((item, index) => ({ ...item, targetId: ids[index], metricKey: index === 0 ? "calories" : item.metricKey,
    ...(rolling ? { evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 7 }, selectionPolicyOverride: { kind: "daily-aggregate", statistic: "mean" } } : {}) }));
}

describe("canonical daily nutrition goal resolution", () => {
  it("resolves all five points with exact provenance without mutating canonical evidence", () => {
    const input = [goal("accepted")];
    const before = structuredClone(input);
    const result = resolveMealNutritionGoals(input, date);
    expect(result.status).toBe("ready");
    expect(result.targets.calories).toEqual({ status: "resolved", target: 1800, provenance: [{ goalId: "accepted", targetId: "dietary-calories", metricKey: "dietary-calories", unit: "kcal", window: { startAt: "2026-07-01" } }] });
    expect(input).toEqual(before);
  });
  it("finds competing authority outside any list prefix regardless of title or domain", () => {
    const result = resolveMealNutritionGoals([goal("accepted"), ...Array.from({ length: 60 }, (_, i) => goal(`other-${i}`, [])), goal("hidden", [target("protein-grams", 99)])], date);
    expect(result.status).toBe("conflict");
    expect(result.targets.proteinGrams.target).toBeNull();
    expect(result.targets.proteinGrams.provenance).toHaveLength(2);
  });
  it("fails closed at the existing active goal cap without returning a misleading prefix", () => {
    const result = resolveMealNutritionGoals(Array.from({ length: 200 }, (_, i) => goal(`goal-${i}`)), date);
    expect(result.status).toBe("capacity");
    expect(result.targets.calories.target).toBeNull();
  });
  it("uses inclusive goal and target windows and excludes inactive or future conflicts", () => {
    const selected = goal("accepted", bundle().map((t) => ({ ...t, startAt: date, targetAt: date })));
    selected.attributes.window = { startAt: date, targetAt: date };
    expect(resolveMealNutritionGoals([selected, goal("paused", bundle(), { status: "paused" }), goal("future", [target("dietary-calories", 900, { startAt: "2026-08-01" })])], date).status).toBe("ready");
    expect(resolveMealNutritionGoals([selected], "2026-07-29").targets.calories.target).toBeNull();
    expect(resolveMealNutritionGoals([selected], "2026-07-31").targets.calories.target).toBeNull();
  });
  it.each([
    { unit: "kJ" }, { comparator: ">=" }, { highValue: 1900 },
    { evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 7 } },
    { value: 1199, highValue: 1199 },
  ])("withholds incompatible calorie values %j", (override) => {
    const result = resolveMealNutritionGoals([goal("accepted", [target("dietary-calories", 1800, override), ...bundle().slice(1)])], date);
    expect(result.status).toBe("incompatible");
    expect(result.targets.calories.target).toBeNull();
  });
  it("ignores unrelated targets and malformed ambiguous legacy calories beside canonical authority", () => {
    const unrelated = goal("running", [target("steps", 9000)]);
    const malformedLegacy = goal("legacy", [target("calories", 1800, { targetId: "daily-calories", evaluation: { kind: "unknown" } })]);
    const result = resolveMealNutritionGoals([goal("accepted"), unrelated, malformedLegacy], date);
    expect(result.status).toBe("ready");
    expect(result.targets.calories.provenance.map(({ goalId }) => goalId)).toEqual(["accepted"]);
  });
  it("ignores malformed legacy-only goal windows when canonical calorie authority applies", () => {
    const legacy = goal("legacy", [target("calories", 1800, { targetId: "daily-calories" })]);
    legacy.attributes.window = { startAt: "invalid" };
    expect(resolveMealNutritionGoals([goal("accepted"), legacy], date).status).toBe("ready");
    expect(resolveMealNutritionGoals([legacy], date).status).toBe("incompatible");
  });
  it("does not fabricate missing targets and preserves compatible fixed points", () => {
    const result = resolveMealNutritionGoals([goal("protein", [target("protein-grams", 130)])], date);
    expect(result.status).toBe("missing");
    expect(result.targets.calories).toEqual({ status: "missing", target: null, provenance: [] });
    expect(result.targets.proteinGrams.target).toBe(130);
  });
  it.each([false, true])("accepts only coherent read-only historical bundles (rolling=%s)", (rolling) => {
    const result = resolveMealNutritionGoals([goal("legacy", historical(rolling))], date);
    expect(result.status).toBe("ready");
    expect(result.compatibility).toBe(rolling ? "historical-rolling-mean" : "historical-selected");
    expect(result.targets.calories.target).toBe(1800);
  });
  it("rejects partial, mixed-evaluation, wrong-identity, and cross-goal historical bundles", () => {
    const mixed = historical(true); mixed[0] = historical(false)[0]!;
    const wrong = historical(); wrong[0] = { ...wrong[0]!, targetId: "activity-calories" };
    for (const goals of [[goal("legacy", historical().slice(0, 4))], [goal("legacy", mixed)], [goal("legacy", wrong)],
      [goal("legacy", historical().slice(0, 1)), goal("macros", historical().slice(1))]]) {
      const result = resolveMealNutritionGoals(goals, date);
      expect(result.status).not.toBe("ready");
      expect(result.targets.calories.target).toBeNull();
    }
  });
  it("ignores ambiguous calories when canonical calorie authority exists but never overrides incompatible canonical authority", () => {
    expect(resolveMealNutritionGoals([goal("accepted"), goal("activity", [target("calories", 3000)])], date).status).toBe("ready");
    const result = resolveMealNutritionGoals([goal("canonical", [target("dietary-calories", 1800, { unit: "kJ" })]), goal("legacy", historical())], date);
    expect(result.status).toBe("incompatible");
    expect(result.targets.calories.target).toBeNull();
  });
  it("fails closed on malformed applicable nutrition data without sanitizing it into authority", () => {
    expect(resolveMealNutritionGoals([goal("bad", [target("dietary-calories", 1800, { evaluation: { kind: "unknown" } })])], date).status).toBe("incompatible");
  });
  it("resolves the canonical goal source after an accepted write and rereads status changes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-nutrition-query-"));
    try {
      await initializeVault({ vaultRoot, createdAt: "2026-07-01T12:00:00Z" });
      const saved = await upsertGoal({ vaultRoot, slug: "synthetic-nutrition", title: "Synthetic nutrition",
        status: "active", window: { startAt: "2026-07-01" }, metricTargets: bundle().map((item) => goalMetricTargetSchema.parse(item)) });
      const resolved = await readMealNutritionTotals(vaultRoot, { from: date, to: date, resolveGoals: true });
      expect(resolved.goalContext?.status).toBe("ready");
      expect(resolved.goalContext?.targets.calories.target).toBe(1800);
      await upsertGoal({ vaultRoot, goalId: saved.record.entity.goalId, status: "paused" });
      const paused = await readMealNutritionTotals(vaultRoot, { from: date, to: date, resolveGoals: true });
      expect(paused.goalContext?.status).toBe("missing");
      expect(paused.goalContext?.targets.calories.target).toBeNull();
    } finally { await rm(vaultRoot, { recursive: true, force: true }); }
  });
  it("reads canonical events and goals once and preserves ordinary totals result shape", async () => {
    const spy = vi.spyOn(source, "readCanonicalEntityFamilySource").mockImplementation(async (_, family) => family === "goal" ? [goal("accepted")] : []);
    try {
      const ordinary = await readMealNutritionTotals("synthetic-vault", { from: date, to: date });
      expect(ordinary).not.toHaveProperty("goalContext");
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();
      const resolved = await readMealNutritionTotals("synthetic-vault", { from: date, to: date, resolveGoals: true });
      expect(spy.mock.calls.map((call) => call[1]).sort()).toEqual(["event", "goal"]);
      expect(resolved.goalContext?.status).toBe("ready");
      const { goalContext, ...totals } = resolved;
      expect(totals).toEqual(ordinary);
      expect(goalContext?.localDate).toBe(date);
    } finally { spy.mockRestore(); }
  });
  it("rejects broad or implicit dates before canonical IO", async () => {
    const spy = vi.spyOn(source, "readCanonicalEntityFamilySource");
    try {
      await expect(readMealNutritionTotals("synthetic-vault", { resolveGoals: true })).rejects.toThrow("identical explicit");
      await expect(readMealNutritionTotals("synthetic-vault", { resolveGoals: true, from: date, to: "2026-08-01" })).rejects.toThrow("identical explicit");
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
