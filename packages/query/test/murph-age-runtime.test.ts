import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { QUERY_DB_RELATIVE_PATH, openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import {
  METRIC_POINT_SCHEMA_VERSION,
  normalizeMetricValue,
  type MetricPoint,
  type MurphAgeRiskModel,
} from "@murphai/health-metrics";
import { test } from "vitest";

import {
  calculateMurphAgeForVault,
  metricPointFiltersForMurphAgeModel,
  rebuildQueryProjection,
} from "../src/index.ts";

test("calculateMurphAgeForVault scores a supplied model from stored lab and wearable MetricPoints", async () => {
  const vaultRoot = await createProjectionVault();
  try {
    await rebuildQueryProjection(vaultRoot);
    insertMetricPoints(vaultRoot, [
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:steps:2026-05-08:wearable:0",
        metricKey: "steps",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_steps",
        sourceKind: "wearable-summary",
        unit: "count",
        value: 10_000,
      }),
      metricPoint({
        biomarkerKey: "biomarker:apob",
        effectiveDate: "2026-05-01",
        id: "metric-point:apob:2026-05-01:lab:0",
        metricKey: "apob",
        observedAt: "2026-05-01T08:00:00.000Z",
        recordId: "lab_apob",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 110,
      }),
      metricPoint({
        biomarkerKey: "biomarker:apob",
        effectiveDate: "2026-05-10",
        id: "metric-point:apob:2026-05-10:lab:0",
        metricKey: "apob",
        observedAt: "2026-05-10T23:59:00.000Z",
        recordId: "same_day_future_lab_apob",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 300,
      }),
      metricPoint({
        biomarkerKey: "biomarker:apob",
        effectiveDate: "2026-05-11",
        id: "metric-point:apob:2026-05-11:lab:0",
        metricKey: "apob",
        observedAt: "2026-05-11T08:00:00.000Z",
        recordId: "future_lab_apob",
        sourceKind: "test-result",
        unit: "mg/dL",
        value: 300,
      }),
      metricPoint({
        effectiveDate: "2026-05-08",
        id: "metric-point:rhr:2026-05-08:wearable:0",
        metricKey: "resting-heart-rate",
        observedAt: "2026-05-08T08:00:00.000Z",
        recordId: "wearable_rhr",
        sourceKind: "wearable-summary",
        unit: "bpm",
        value: 62,
      }),
    ]);

    const filters = metricPointFiltersForMurphAgeModel(
      fixtureMurphAgeModel(),
      "2026-05-10T00:00:00.000Z",
    );
    assert.deepEqual(filters.map((filter) => filter.to), ["2026-05-10", "2026-05-10", "2026-05-10", "2026-05-10"]);
    assert.equal(filters.every((filter) => filter.limit === null), true);

    const result = await calculateMurphAgeForVault({
      asOf: "2026-05-10T00:00:00.000Z",
      chronologicalAgeYears: 45,
      model: fixtureMurphAgeModel(),
      sex: "male",
      vaultRoot,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.biologicalAgeYears, 42.1);
    assert.equal(result.ageDeltaYears, -2.9);
    assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "apob")?.value, 110);
    assert.equal(result.featureAttributions.find((feature) => feature.featureKey === "steps")?.selectedPointIds[0], "metric-point:steps:2026-05-08:wearable:0");
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("calculateMurphAgeForVault abstains on invalid models before reading the vault", async () => {
  const result = await calculateMurphAgeForVault({
    asOf: "2026-05-10T00:00:00.000Z",
    chronologicalAgeYears: 45,
    model: {
      ...fixtureMurphAgeModel(),
      intercept: Number.NaN,
    },
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(result.status, "abstain");
  assert.equal(result.warnings.some((warning) => warning.code === "INVALID_INPUT"), true);
  assert.equal(result.featureAttributions.length, 0);
});

test("calculateMurphAgeForVault requires a valid asOf timestamp before reading the vault", async () => {
  const result = await calculateMurphAgeForVault({
    asOf: "not-a-date",
    chronologicalAgeYears: 45,
    model: fixtureMurphAgeModel(),
    sex: "female",
    vaultRoot: path.join(os.tmpdir(), "murph-age-missing-vault"),
  });

  assert.equal(result.status, "abstain");
  assert.equal(result.warnings[0]?.code, "INVALID_INPUT");
  assert.equal(result.warnings[0]?.message, "Murph Age query runtime requires a valid asOf timestamp.");
});

async function createProjectionVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-age-query-runtime-"));
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: "2026-05-01T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Test Vault",
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
    }, null, 2)}\n`,
  );
  await writeFile(path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl"), "");
  return vaultRoot;
}

function insertMetricPoints(vaultRoot: string, points: readonly MetricPoint[]): void {
  const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), { create: false });
  try {
    const insertMetricPoint = database.prepare(`
      INSERT INTO query_metric_points (
        id,
        sort_rank,
        metric_key,
        biomarker_key,
        value,
        text_value,
        comparator,
        unit,
        canonical_value,
        canonical_unit,
        observed_at,
        effective_date,
        recorded_at,
        reported_at,
        grain,
        statistic,
        source_family,
        source_kind,
        source_record_id,
        source_result_index,
        source_path,
        confidence,
        provenance_json,
        context_json,
        metric_point_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    points.forEach((point, index) => {
      insertMetricPoint.run(
        point.id,
        index,
        point.metricKey,
        point.biomarkerKey,
        point.value,
        point.textValue,
        point.comparator,
        point.unit,
        point.canonicalValue,
        point.canonicalUnit,
        point.observedAt,
        point.effectiveDate,
        point.recordedAt,
        point.reportedAt,
        point.grain,
        point.statistic,
        point.source.family,
        point.source.kind,
        point.source.recordId,
        point.source.resultIndex,
        point.source.path,
        point.confidence,
        JSON.stringify(point.provenance),
        JSON.stringify(point.context),
        JSON.stringify(point),
      );
    });
  } finally {
    database.close();
  }
}

function metricPoint(input: {
  biomarkerKey?: string | null;
  effectiveDate: string;
  id: string;
  metricKey: string;
  observedAt: string;
  recordId: string;
  sourceKind: MetricPoint["source"]["kind"];
  unit: string | null;
  value: number;
}): MetricPoint {
  const normalized = normalizeMetricValue({
    metricKey: input.metricKey,
    unit: input.unit,
    value: input.value,
  });

  return {
    biomarkerKey: input.biomarkerKey ?? null,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: input.effectiveDate,
    grain: "day",
    id: input.id,
    metricKey: input.metricKey,
    observedAt: input.observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Fixture",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: input.sourceKind === "test-result" ? "event" : "derived",
      kind: input.sourceKind,
      path: "ledger/events/2026/2026-05.jsonl",
      recordId: input.recordId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit,
    value: input.value,
  };
}

function fixtureMurphAgeModel(): MurphAgeRiskModel {
  return {
    endpoint: "10-year all-cause mortality",
    features: [
      { coefficient: 0.06, key: "age", kind: "chronological-age", label: "Age" },
      { coefficient: 0.15, key: "male", kind: "sex", label: "Male", sex: "male" },
      {
        coefficient: -0.1,
        key: "steps",
        kind: "metric",
        label: "Steps",
        metricKey: "steps",
        moduleId: "activity",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 8_000, standardDeviation: 2_000 },
      },
      {
        coefficient: 0.18,
        key: "apob",
        kind: "metric",
        label: "ApoB",
        metricKey: "apob",
        moduleId: "biomarkers",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 90, standardDeviation: 20 },
      },
      {
        coefficient: 0.12,
        key: "resting-heart-rate",
        kind: "metric",
        label: "Resting heart rate",
        metricKey: "resting-heart-rate",
        moduleId: "recovery",
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 60, standardDeviation: 10 },
      },
      {
        coefficient: -0.04,
        key: "hrv-optional",
        kind: "metric",
        label: "HRV",
        metricKey: "hrv-rmssd",
        moduleId: "recovery",
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: "z-score", mean: 45, standardDeviation: 15 },
      },
    ],
    horizonYears: 10,
    intercept: -6.2,
    modelId: "fixture-query-runtime-model",
    modelVersion: "test.0",
    referencePopulation: "fixture adult reference curve",
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.01 },
      { ageYears: 40, riskProbability: 0.03 },
      { ageYears: 60, riskProbability: 0.1 },
      { ageYears: 80, riskProbability: 0.3 },
    ],
    uncertainty: {
      baseYears: 1.5,
      perMissingOptionalFeatureYears: 2,
    },
  };
}
