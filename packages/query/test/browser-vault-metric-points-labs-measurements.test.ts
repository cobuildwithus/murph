import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  QUERY_DB_RELATIVE_PATH,
  openSqliteRuntimeDatabase,
} from "@murphai/runtime-state/node";
import { test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
} from "../src/browser.ts";
import {
  buildMetricProjection,
  listCanonicalEntities,
  rebuildQueryProjection,
} from "../src/index.ts";

type CanonicalEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];
type CreateReplicaInput = Omit<Parameters<typeof createBrowserVaultReplica>[0], "metricPoints">;

async function createBrowserVaultReplicaFromVault(input: CreateReplicaInput) {
  return createBrowserVaultReplica({
    ...input,
    metricPoints: buildMetricProjection(input.vault).metricPoints,
  });
}

test("browser-vault metric points project manual measurements, metric samples, and blood-test results through one primitive", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-05-02T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_measurement", "measurement", {
          occurredAt: "2026-05-02T09:30:00.000Z",
          title: "Morning body check",
          attributes: {
            measurements: [
              { metric: "body weight", value: 180, unit: "lb" },
              { metric: "body_fat_pct", value: 14.8, unit: "percent" },
              { metric: "glucose", value: 88, unit: "mg_dL" },
            ],
            source: "manual",
          },
        }),
        createEvent("evt_blood_panel", "test", {
          occurredAt: "2026-05-01T10:00:00.000Z",
          title: "Function Health panel",
          attributes: {
            collectedAt: "2026-05-02T08:15:00.000Z",
            fastingStatus: "fasting",
            labName: "Function Health",
            reportedAt: "2026-05-02T18:00:00.000Z",
            resultStatus: "normal",
            results: [
              {
                analyte: "Apolipoprotein B",
                biomarkerSlug: "apob",
                flag: "normal",
                referenceRange: { text: "<90" },
                unit: "g/L",
                value: 0.87,
              },
              {
                analyte: "Apolipoprotein B",
                biomarkerSlug: "apob",
                flag: "normal",
                referenceRange: { text: "<90" },
                unit: "mg/dL",
                value: 87,
              },
              {
                analyte: "Glucose",
                biomarkerSlug: "glucose",
                flag: "normal",
                unit: "mg/dL",
                value: 82,
              },
              {
                analyte: "Glucose",
                biomarkerSlug: "glucose",
                unit: "mmol/L",
                value: 5.5,
              },
              {
                analyte: "hs-CRP",
                comparator: "<",
                slug: "hs-crp",
                unit: "mg/L",
                value: 0.3,
              },
              {
                analyte: "Unreviewed private panel note",
                unit: "score",
                value: 5,
              },
            ],
            source: "manual",
            testCategory: "blood",
            testName: "functional_health_panel",
          },
        }),
        createMetricSample("smp_metric_rhr_manual", {
          recordedAt: "2026-05-03T07:00:00.000Z",
          attributes: {
            metric: "resting-heart-rate",
            recordedAt: "2026-05-03T07:00:00.000Z",
            dayKey: "2026-05-03",
            source: "manual",
            quality: "raw",
            value: 55,
            unit: "bpm",
          },
        }),
        createMetricSample("smp_metric_rhr_raw_device", {
          recordedAt: "2026-05-04T07:00:00.000Z",
          attributes: {
            metric: "resting-heart-rate",
            recordedAt: "2026-05-04T07:00:00.000Z",
            dayKey: "2026-05-04",
            source: "device",
            quality: "raw",
            qualifiers: { summary: true },
            value: 40,
            unit: "bpm",
          },
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  const bodyWeight = client.metricSelections.get("body-weight");
  assert.ok(bodyWeight);
  assert.equal(bodyWeight.unit, "kg");
  assert.equal(Number((bodyWeight.value ?? NaN).toFixed(1)), 81.6);
  assert.equal(bodyWeight.sourceLabel, "Manual");
  assert.equal(bodyWeight.recordIds[0], "evt_measurement");

  const bodyFat = client.metricSelections.get("body-fat-percentage");
  assert.ok(bodyFat);
  assert.equal(bodyFat.valueLabel, "14.8");
  assert.equal(bodyFat.unit, "percent");

  const restingHeartRate = client.metricSelections.getByBiomarker("biomarker:resting-heart-rate");
  assert.ok(restingHeartRate);
  assert.equal(restingHeartRate.value, 55);
  assert.equal(restingHeartRate.sourceLabel, "Manual");
  assert.equal(restingHeartRate.recordIds[0], "smp_metric_rhr_manual");
  assert.deepEqual(client.metrics.series({ metricKey: "resting-heart-rate" }).map((point) => point.value), [55]);
  assert.deepEqual(
    client.entities.list({ families: ["sample"], kinds: ["metric_sample"] }).map((entity) => entity.id),
    ["smp_metric_rhr_manual"],
  );
  assert.equal(
    client.entities.list({ families: ["sample"], kinds: ["metric_sample"] }).some((entity) => entity.id === "smp_metric_rhr_raw_device"),
    false,
  );
  assert.deepEqual(
    client.replica.weeklySampleSummaries
      .filter((summary) => summary.stream === "resting-heart-rate")
      .map((summary) => [summary.date, summary.sampleCount, summary.sumValue]),
    [["2026-05-03", 1, 55]],
  );

  const apob = client.metricSelections.get("apob");
  assert.ok(apob);
  assert.equal(apob.value, 87);
  assert.equal(apob.unit, "mg/dL");
  assert.equal(apob.sourceLabel, "Function Health");
  assert.equal(apob.recordIds[0], "evt_blood_panel");
  const apobSeries = client.metrics.series({ metricKey: "apob" });
  assert.deepEqual(apobSeries.map((point) => ({ unit: point.unit, value: point.value })), [
    { unit: "mg/dL", value: 87 },
  ]);
  assert.equal(apobSeries.every((point) => /^metric-point:[0-9a-f]{16}$/u.test(point.pointIds[0] ?? "")), true);

  const glucose = client.metricSelections.getByBiomarker("biomarker:blood-glucose");
  assert.ok(glucose);
  assert.equal(glucose.metricKey, "glucose");
  assert.equal(glucose.value, 82);
  assert.equal(glucose.sourceLabel, "Function Health");
  assert.equal(glucose.warnings.some((warning) => warning.code === "MIXED_SOURCES"), true);
  assert.deepEqual(
    client.metrics
      .series({ metricKey: "glucose" })
      .map((point) => point.value)
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => left - right),
    [82, 88, 99.1001],
  );

  const crp = client.metricSelections.get("hs-crp");
  assert.ok(crp);
  assert.equal(crp.valueLabel, "<0.3");
  assert.equal(crp.unit, "mg/L");
  assert.equal(client.metricSelections.get("unreviewed-private-panel-note"), null);
  assert.deepEqual(
    client.metrics.series({ metricKey: "unreviewed-private-panel-note" }).map((point) => point.value),
    [5],
  );

  assert.equal(client.metrics.series({ metricKey: "body-weight" }).length, 1);
  assert.equal(client.metrics.latestRow({ metricKey: "apob" })?.sourceKind, "test-result");
});

test("browser-vault replica surfaces custom observation metrics without catalog enrollment", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-05-02T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        // Neither metric has a catalog definition or an explicit binding:
        // the projection is the source of truth for which metrics exist,
        // so the replica must carry them without enrollment anywhere.
        createEvent("evt_caffeine_observation", "observation", {
          occurredAt: "2026-05-01T18:00:00.000Z",
          title: "Junction caffeine intake",
          attributes: {
            dayKey: "2026-05-01",
            metric: "caffeine",
            observationGrain: "summary",
            source: "device",
            unit: "mg",
            value: 140,
          },
        }),
        createEvent("evt_height_observation", "observation", {
          occurredAt: "2026-05-01T09:00:00.000Z",
          title: "Junction height",
          attributes: {
            dayKey: "2026-05-01",
            metric: "height",
            source: "device",
            unit: "cm",
            value: 180,
          },
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  const caffeineSeries = client.metrics.series({ metricKey: "caffeine" });
  assert.equal(caffeineSeries.length, 1);
  assert.equal(caffeineSeries[0]?.value, 140);

  const heightRow = client.metrics.latestRow({ metricKey: "height" });
  assert.ok(heightRow);
  assert.equal(heightRow.sourceKind, "observation");
});

test("browser-vault metric rows preserve same-day lab record ids for anchored experiment lookups", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-24T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_anchor_ldl", "test", {
          occurredAt: "2026-04-23T08:00:00.000Z",
          attributes: {
            collectedAt: "2026-04-23T08:00:00.000Z",
            results: [
              {
                analyte: "LDL-C",
                biomarkerSlug: "ldl-c",
                unit: "mg/dL",
                value: 140,
              },
            ],
          },
        }),
        createEvent("evt_same_day_ldl", "test", {
          occurredAt: "2026-04-23T09:00:00.000Z",
          attributes: {
            collectedAt: "2026-04-23T09:00:00.000Z",
            results: [
              {
                analyte: "LDL-C",
                biomarkerSlug: "ldl-c",
                unit: "mg/dL",
                value: 150,
              },
            ],
          },
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const rows = client.metrics.series({ metricKey: "ldl-c" });

  assert.deepEqual(rows.map((row) => [row.value, row.recordIds]), [
    [140, ["evt_anchor_ldl"]],
    [150, ["evt_same_day_ldl"]],
  ]);
});

test("browser-vault metric goal targets honor startAt when selecting rolling-window progress", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-30T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_rhr_pre_start", "measurement", {
          occurredAt: "2026-04-23T07:00:00.000Z",
          title: "Pre-start resting heart rate",
          attributes: {
            measurements: [
              { metric: "restingHeartRate", value: 30, unit: "bpm" },
            ],
            source: "manual",
          },
        }),
        ...Array.from({ length: 6 }, (_, index) => createEvent(`evt_rhr_${index + 1}`, "measurement", {
          occurredAt: `2026-04-${String(24 + index).padStart(2, "0")}T07:00:00.000Z`,
          title: `Rolling heart rate ${index + 1}`,
          attributes: {
            measurements: [
              { metric: "restingHeartRate", value: 50, unit: "bpm" },
            ],
            source: "manual",
          },
        })),
        {
          attributes: {},
          body: null,
          date: "2026-04-20",
          entityId: "goal_rhr",
          experimentSlug: null,
          family: "goal",
          frontmatter: {
            status: "active",
            metricTargets: [{
              comparator: "<",
              evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 7 },
              kind: "metric",
              metricKey: "resting-heart-rate",
              startAt: "2026-04-24",
              targetAt: "2026-04-30",
              targetId: "rhr-under-49",
              unit: "bpm",
              value: 49,
            }],
          },
          kind: "goal",
          links: [],
          lookupIds: ["goal_rhr"],
          occurredAt: "2026-04-20T00:00:00.000Z",
          path: "history/goals/goal_rhr.md",
          primaryLookupId: "goal_rhr",
          recordClass: "bank",
          relatedIds: [],
          status: "active",
          stream: null,
          tags: [],
          title: "Resting heart rate goal",
        } satisfies CanonicalEntity,
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const progress = replica.metricGoalProgressRows.find((row) => row.goalId === "goal_rhr");
  assert.ok(progress);
  assert.equal(progress.status, "behind");
  assert.equal(progress.currentValue, 50);
  assert.equal(progress.selectedPointIds.length, 6);
});

test("browser-vault metric goal targets honor selectionPolicyOverride from goal frontmatter", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-30T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_apob_non_fasting", "test", {
          occurredAt: "2026-04-29T09:30:00.000Z",
          title: "Non-fasting apob result",
          attributes: {
            collectedAt: "2026-04-29T09:30:00.000Z",
            fastingStatus: "non_fasting",
            labName: "Function Health",
            results: [{
              analyte: "Apolipoprotein B",
              biomarkerSlug: "apob",
              unit: "mg/dL",
              value: 87,
            }],
            source: "manual",
          },
        }),
        createEvent("evt_apob_fasting", "test", {
          occurredAt: "2026-04-29T07:30:00.000Z",
          title: "Fasting apob result",
          attributes: {
            collectedAt: "2026-04-29T07:30:00.000Z",
            fastingStatus: "fasting",
            labName: "Function Health",
            results: [{
              analyte: "Apolipoprotein B",
              biomarkerSlug: "apob",
              unit: "mg/dL",
              value: 82,
            }],
            source: "manual",
          },
        }),
        {
          attributes: {},
          body: null,
          date: "2026-04-20",
          entityId: "goal_apob",
          experimentSlug: null,
          family: "goal",
          frontmatter: {
            status: "active",
            metricTargets: [{
              biomarkerKey: "biomarker:apob",
              comparator: "<",
              evaluation: { kind: "selected-value" },
              kind: "metric",
              metricKey: "apob",
              selectionPolicyOverride: {
                kind: "latest-lab",
                preferCollectedAt: true,
                preferFasting: true,
              },
              targetId: "apob-under-85",
              unit: "mg/dL",
              value: 85,
            }],
          },
          kind: "goal",
          links: [],
          lookupIds: ["goal_apob"],
          occurredAt: "2026-04-20T00:00:00.000Z",
          path: "history/goals/goal_apob.md",
          primaryLookupId: "goal_apob",
          recordClass: "bank",
          relatedIds: [],
          status: "active",
          stream: null,
          tags: [],
          title: "Apolipoprotein B goal",
        } satisfies CanonicalEntity,
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const metricSelection = client.metricSelections.get("apob");
  const progress = client.metricGoals.progress({ goalId: "goal_apob" })[0];

  assert.ok(metricSelection);
  assert.equal(metricSelection.value, 87);
  assert.deepEqual(metricSelection.recordIds, ["evt_apob_non_fasting"]);
  assert.ok(progress);
  assert.equal(progress.currentValue, 82);
  assert.equal(progress.selectedPointIds.length, 1);
  assert.notEqual(progress.selectedPointIds[0], metricSelection.pointIds[0]);
});

test("browser-vault metric selections can use old requested points while metric rows stay lookback bounded", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-05-02T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_weight_measurement", "measurement", {
          occurredAt: "2024-01-01T07:30:00.000Z",
          title: "Old body check",
          attributes: {
            measurements: [
              { metric: "body_weight", value: 180, unit: "lb" },
              { metric: "private_reaction_score", value: 5, unit: "score" },
            ],
            source: "manual",
          },
        }),
        createEvent("evt_recent_private_reaction", "measurement", {
          occurredAt: "2026-04-30T07:30:00.000Z",
          title: "Recent private reaction score",
          attributes: {
            measurements: [
              { metric: "private_reaction_score", value: 9, unit: "score" },
            ],
            source: "manual",
          },
        }),
        {
          attributes: {},
          body: null,
          date: "2024-01-01",
          entityId: "goal_weight",
          experimentSlug: null,
          family: "goal",
          frontmatter: {
            metricTargets: [{
              comparator: "<",
              evaluation: { kind: "selected-value" },
              kind: "metric",
              metricKey: "body-weight",
              targetId: "weight-under-82",
              unit: "kg",
              value: 82,
            }],
            status: "active",
          },
          kind: "goal",
          links: [],
          lookupIds: ["goal_weight"],
          occurredAt: "2024-01-01T00:00:00.000Z",
          path: "history/goals/goal_weight.md",
          primaryLookupId: "goal_weight",
          recordClass: "bank",
          relatedIds: [],
          status: "active",
          stream: null,
          tags: [],
          title: "Body weight goal",
        } satisfies CanonicalEntity,
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  const bodyWeightPoints = client.metrics.series({ metricKey: "body-weight" });
  assert.deepEqual(bodyWeightPoints, []);
  assert.deepEqual(client.metrics.series({ metricKey: "private-reaction-score" }), []);
  assert.equal(client.metricSelections.get("private-reaction-score"), null);

  const bodyWeight = client.metricSelections.get("body-weight");
  assert.ok(bodyWeight);
  assert.equal(bodyWeight.status, "stale");
  assert.equal(bodyWeight.unit, "kg");
  assert.equal(Number((bodyWeight.value ?? NaN).toFixed(1)), 81.6);
  assert.equal(bodyWeight.selectedMetricRowId, null);
  assert.deepEqual(bodyWeight.recordIds, ["evt_weight_measurement"]);
  assert.equal(bodyWeight.warnings.some((warning) => warning.code === "SOURCE_STALE"), true);

  const progress = client.metricGoals.progress({ goalId: "goal_weight" })[0];
  assert.ok(progress);
  assert.equal(progress.status, "stale");
  assert.equal(Number((progress.currentValue ?? NaN).toFixed(1)), 81.6);
});

test("browser-vault metric rows keep old lab points when experiment measurement anchors request them", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-05-02T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEvent("evt_anchor_apob_baseline", "test", {
          occurredAt: "2024-01-01T08:00:00.000Z",
          title: "Baseline lipid panel",
          attributes: {
            collectedAt: "2024-01-01T08:00:00.000Z",
            labName: "Function Health",
            results: [{
              analyte: "Apolipoprotein B",
              biomarkerSlug: "apob",
              unit: "mg/dL",
              value: 101,
            }],
            source: "manual",
          },
        }),
        createEvent("evt_unanchored_glucose_old", "test", {
          occurredAt: "2024-01-01T08:05:00.000Z",
          title: "Old glucose panel",
          attributes: {
            collectedAt: "2024-01-01T08:05:00.000Z",
            labName: "Function Health",
            results: [{
              analyte: "Glucose",
              biomarkerSlug: "glucose",
              unit: "mg/dL",
              value: 86,
            }],
            source: "manual",
          },
        }),
        {
          attributes: {},
          body: null,
          date: "2026-05-02",
          entityId: "exp_apob_anchor",
          experimentSlug: "apob-anchor",
          family: "experiment",
          frontmatter: {
            analysisPlan: {
              primaryBiomarkerKey: "biomarker:apob",
              measurementAnchors: [{
                role: "baseline",
                kind: "lab_panel",
                recordId: "evt_anchor_apob_baseline",
                biomarkerKeys: ["biomarker:apob"],
                observedOn: "2024-01-01",
              }],
            },
            status: "active",
          },
          kind: "experiment_entry",
          links: [],
          lookupIds: ["exp_apob_anchor", "apob-anchor"],
          occurredAt: "2026-05-02T00:00:00.000Z",
          path: "bank/experiments/apob-anchor.md",
          primaryLookupId: "exp_apob_anchor",
          recordClass: "bank",
          relatedIds: [],
          status: "active",
          stream: null,
          tags: [],
          title: "ApoB anchor experiment",
        } satisfies CanonicalEntity,
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));

  const apobSeries = client.metrics.series({ metricKey: "apob" });
  assert.deepEqual(apobSeries.map((point) => [point.date, point.value, point.recordIds]), [
    ["2024-01-01", 101, ["evt_anchor_apob_baseline"]],
  ]);
  assert.deepEqual(client.metrics.series({ metricKey: "glucose" }), []);
  assert.equal(replica.metricSelectionRows.some((row) =>
    row.metricKey === "glucose" && row.recordIds.includes("evt_unanchored_glucose_old")
  ), false);
});

test("query projection rebuild stores shared event and wearable metric points in the projection table", async () => {
  const vaultRoot = await createMetricPointProjectionVault();

  try {
    const rebuilt = await rebuildQueryProjection(vaultRoot);
    assert.equal(rebuilt.schemaVersion, "murph.query-projection");

    const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), {
      create: false,
      readOnly: true,
    });

    try {
      const rows = database.prepare(`
        SELECT
          metric_key AS metricKey,
          biomarker_key AS biomarkerKey,
          unit,
          value,
          canonical_value AS canonicalValue,
          source_kind AS sourceKind,
          source_record_id AS sourceRecordId,
          metric_point_json AS metricPointJson
        FROM query_metric_points
        ORDER BY metric_key ASC
      `).all() as Array<{
        biomarkerKey: string | null;
        canonicalValue: number | null;
        metricKey: string;
        metricPointJson: string;
        sourceKind: string;
        sourceRecordId: string;
        unit: string;
        value: number;
      }>;

      assert.deepEqual(rows.map((row) => row.metricKey), ["apob", "body-weight", "resting-heart-rate", "steps"]);
      assert.equal(rows.find((row) => row.metricKey === "body-weight")?.unit, "kg");
      assert.equal(rows.find((row) => row.metricKey === "body-weight")?.value, 81.6466);
      assert.equal(
        Number(rows.find((row) => row.metricKey === "body-weight")?.canonicalValue?.toFixed(1)),
        81.6,
      );
      assert.equal(rows.find((row) => row.metricKey === "apob")?.biomarkerKey, "biomarker:apob");
      assert.equal(rows.find((row) => row.metricKey === "apob")?.sourceKind, "test-result");
      assert.equal(rows.find((row) => row.metricKey === "resting-heart-rate")?.sourceKind, "metric-sample");
      assert.equal(rows.find((row) => row.metricKey === "resting-heart-rate")?.sourceRecordId, "smp_projection_rhr");
      assert.deepEqual(
        [rows.find((row) => row.metricKey === "apob")?.sourceRecordId],
        ["evt_projection_test"],
      );
      assert.equal(rows.find((row) => row.metricKey === "steps")?.sourceKind, "metric-sample");
      assert.deepEqual(
        [rows.find((row) => row.metricKey === "steps")?.sourceRecordId],
        ["smp_projection_steps"],
      );
      const stepsPoint = JSON.parse(
        rows.find((row) => row.metricKey === "steps")?.metricPointJson ?? "null",
      ) as { context?: { contributingRecordIds?: unknown }; source?: unknown } | null;
      assert.ok(stepsPoint);
      assert.equal(Object.hasOwn(stepsPoint, "source"), false);
      assert.equal(stepsPoint.context?.contributingRecordIds, undefined);
      assert.doesNotMatch(
        rows.find((row) => row.metricKey === "steps")?.metricPointJson ?? "",
        /smp_projection_steps/u,
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("listCanonicalEntities applies projection-table family, kind, and date filters", async () => {
  const vaultRoot = await createMetricPointProjectionVault();

  try {
    const testEvents = await listCanonicalEntities(vaultRoot, {
      family: "event",
      from: "2026-05-02",
      kinds: ["test"],
      to: "2026-05-02",
    });
    assert.deepEqual(testEvents.map((entity) => entity.entityId), ["evt_projection_test"]);

    const staleMeasurements = await listCanonicalEntities(vaultRoot, {
      family: "event",
      from: "2026-05-02",
      kinds: ["measurement"],
    });
    assert.deepEqual(staleMeasurements, []);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

function createEvent(
  entityId: string,
  kind: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  const occurredAt = overrides.occurredAt ?? "2026-05-01T00:00:00.000Z";
  const date = overrides.date ?? occurredAt.slice(0, 10);

  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date,
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family: "event",
    frontmatter: overrides.frontmatter ?? null,
    kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [entityId],
    occurredAt,
    path: overrides.path ?? `ledger/events/2026/2026-05.jsonl`,
    primaryLookupId: overrides.primaryLookupId ?? entityId,
    recordClass: "ledger",
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream: null,
    tags: overrides.tags ?? [],
    title: overrides.title ?? kind,
  } satisfies CanonicalEntity;
}

function createMetricSample(
  entityId: string,
  input: {
    attributes: Record<string, unknown>;
    recordedAt: string;
  },
): CanonicalEntity {
  return {
    attributes: input.attributes,
    body: null,
    date: input.recordedAt.slice(0, 10),
    entityId,
    experimentSlug: null,
    family: "sample",
    frontmatter: null,
    kind: "metric_sample",
    links: [],
    lookupIds: [entityId],
    occurredAt: input.recordedAt,
    path: `ledger/metric-samples/${input.attributes.metric ?? "metric"}/2026/2026-05.jsonl`,
    primaryLookupId: entityId,
    recordClass: "sample",
    relatedIds: [],
    status: typeof input.attributes.quality === "string" ? input.attributes.quality : null,
    stream: typeof input.attributes.metric === "string" ? input.attributes.metric : null,
    tags: [],
    title: "Metric sample",
  } satisfies CanonicalEntity;
}

async function createMetricPointProjectionVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-metric-points-"));
  const eventsDir = path.join(vaultRoot, "ledger/events/2026");
  const metricSamplesDir = path.join(vaultRoot, "ledger/metric-samples/resting-heart-rate/2026");
  const stepsMetricSamplesDir = path.join(vaultRoot, "ledger/metric-samples/steps/2026");

  await mkdir(eventsDir, { recursive: true });
  await mkdir(metricSamplesDir, { recursive: true });
  await mkdir(stepsMetricSamplesDir, { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify(
      {
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
        title: "Metric points test vault",
        timezone: "America/New_York",
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(eventsDir, "2026-05.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_projection_measurement",
        kind: "measurement",
        occurredAt: "2026-05-01T07:30:00.000Z",
        recordedAt: "2026-05-01T07:31:00.000Z",
        dayKey: "2026-05-01",
        source: "manual",
        title: "Morning body check",
        measurements: [
          { metric: "body weight", value: 180, unit: "lb" },
        ],
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_projection_test",
        kind: "test",
        occurredAt: "2026-05-02T08:00:00.000Z",
        recordedAt: "2026-05-02T18:00:00.000Z",
        dayKey: "2026-05-02",
        source: "manual",
        title: "Blood panel",
        labName: "Function Health",
        collectedAt: "2026-05-02T08:15:00.000Z",
        results: [
          {
            analyte: "Apolipoprotein B",
            biomarkerSlug: "apob",
            unit: "mg/dL",
            value: 87,
          },
        ],
      }),
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(metricSamplesDir, "2026-05.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.metric-sample.v1",
        id: "smp_projection_rhr",
        metric: "resting-heart-rate",
        recordedAt: "2026-05-02T07:00:00.000Z",
        dayKey: "2026-05-02",
        source: "import",
        quality: "normalized",
        qualifiers: { summary: true },
        value: 56,
        unit: "bpm",
      }),
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(stepsMetricSamplesDir, "2026-05.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.metric-sample.v1",
        id: "smp_projection_steps",
        metric: "steps",
        recordedAt: "2026-05-01T21:00:00.000Z",
        dayKey: "2026-05-01",
        externalRef: {
          resourceId: "steps-projection",
          resourceType: "daily_summary",
          system: "garmin",
        },
        source: "import",
        quality: "summary",
        qualifiers: { summary: true },
        value: 9234,
        unit: "count",
      }),
      "",
    ].join("\n"),
  );

  return vaultRoot;
}
