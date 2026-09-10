import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { goalMetricTargetSchema } from "@murphai/contracts";
import { initializeVault, upsertGoal } from "@murphai/core";
import { openSqliteRuntimeDatabase, QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { describe, expect, it } from "vitest";
import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { parseGoalMetricTargets } from "../src/metrics/goals.ts";
import { listMetricTargets, rebuildQueryProjection } from "../src/index.ts";
import { extractMetricTargetsFromCanonicalEntities } from "../src/projection/metric-store.ts";
import { createBrowserVaultReplica, createVaultReadModel } from "../src/browser.ts";

const target = {
  targetId: "weight-range", kind: "metric", metricKey: "body-weight",
  comparator: "between", value: 70, highValue: 80, unit: "kg",
};
function goal(targets: unknown[]): CanonicalEntity {
  return {
    entityId: "synthetic-goal", primaryLookupId: "synthetic-goal", lookupIds: ["synthetic-goal"],
    family: "goal", recordClass: "bank", kind: "goal", status: "active", occurredAt: null,
    date: null, path: "bank/goals/synthetic-goal.md", title: "Synthetic goal", body: null,
    attributes: { metricTargets: targets }, frontmatter: null, links: [], relatedIds: [],
    stream: null, experimentSlug: null, tags: [],
  };
}

describe("canonical goal target interpretation", () => {
  it.each([
    { kind: "latest-valid", staleAfterDays: 7 },
    { kind: "latest-lab", preferFasting: true },
    { kind: "daily-aggregate", statistic: "mean", latestWindowDays: 7, minimumPoints: 2 },
    { kind: "latest-device-estimate" },
    { kind: "qualified-latest", requiredQualifiers: {} },
    { kind: "qualified-latest", requiredQualifiers: { position: "standing", repeated: true } },
  ])("preserves canonical policy and defaults: %j", (selectionPolicyOverride) => {
    const raw = { ...target, selectionPolicyOverride };
    expect(parseGoalMetricTargets(goal([raw]))).toEqual([goalMetricTargetSchema.parse(raw)]);
  });

  it.each([
    { highValue: undefined },
    { evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 0 } },
    { evaluation: { kind: "unknown" } },
    { selectionPolicyOverride: { kind: "unknown" } },
    { selectionPolicyOverride: { kind: "daily-aggregate", statistic: "mean", minimumPoints: -1 } },
    { selectionPolicyOverride: { kind: "qualified-latest", requiredQualifiers: { position: {} } } },
    { targetAt: "not-a-date" },
    { kind: "other" },
  ])("omits invalid targets without replacing their meaning: %j", (overrides) => {
    const raw = { ...target, ...overrides };
    expect(goalMetricTargetSchema.safeParse(raw).success).toBe(false);
    expect(parseGoalMetricTargets(goal([raw, target]))).toEqual([goalMetricTargetSchema.parse(target)]);
  });

  it("retains omitted legacy identity and metric aliases without mutating input", () => {
    const raw = { ...target, targetId: undefined, kind: undefined, metricKey: "body_weight" };
    const entity = goal([null, raw]);
    const before = structuredClone(entity);
    expect(parseGoalMetricTargets(entity)).toEqual([
      goalMetricTargetSchema.parse({ ...target, targetId: "metric-target-2" }),
    ]);
    expect(entity).toEqual(before);
  });

  it("uses the same accepted targets for SQLite and browser progress", async () => {
    const entity = goal([{ ...target, highValue: undefined }, target]);
    const rows = extractMetricTargetsFromCanonicalEntities([entity]);
    expect(rows.map((row) => row.target.targetId)).toEqual([target.targetId]);
    const replica = await createBrowserVaultReplica({
      vault: createVaultReadModel({ entities: [entity], metadata: null, vaultRoot: "browser://vault" }),
      metricPoints: [], generatedAt: "2026-09-10T12:00:00.000Z", sourceBundleHash: "f".repeat(64),
    });
    expect(replica.metricGoalProgressRows.map((row) => row.targetId)).toEqual([target.targetId]);
  });

  it("rebuilds carried v26 targets without modifying the canonical goal", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-goal-contracts-"));
    try {
      await initializeVault({ vaultRoot });
      const accepted = goalMetricTargetSchema.parse({
        ...target, selectionPolicyOverride: { kind: "qualified-latest", requiredQualifiers: {} },
      });
      const saved = await upsertGoal({
        vaultRoot, title: "Synthetic weight goal", status: "active", horizon: "ongoing",
        window: { startAt: "2026-09-01" }, metricTargets: [accepted],
      });
      const canonicalPath = path.join(vaultRoot, saved.record.document.relativePath);
      const before = await readFile(canonicalPath, "utf8");
      await rebuildQueryProjection(vaultRoot);
      const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), { create: false });
      try {
        database.prepare("UPDATE query_metric_targets SET target_json = ?").run(JSON.stringify(target));
        database.exec("PRAGMA user_version = 26;");
      } finally {
        database.close();
      }
      const rows = await listMetricTargets(vaultRoot);
      expect(rows.map((row) => row.target)).toEqual([accepted]);
      expect(await readFile(canonicalPath, "utf8")).toBe(before);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
