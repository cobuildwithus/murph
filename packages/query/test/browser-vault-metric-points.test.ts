import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultMetricSelectionRows,
  createBrowserVaultQueryClient,
  parseBrowserVaultReplica,
  toBrowserVaultMetricRows,
  type BrowserVaultReplica,
} from "../src/browser.ts";
import type { MetricPoint } from "../src/index.ts";

test("browser-vault exposes metric-key rows and selections without legacy domains", () => {
  const points: MetricPoint[] = [
    point("2026-04-28", "resting-heart-rate", "biomarker:resting-heart-rate", 58, "bpm"),
    point("2026-04-29", "resting-heart-rate", "biomarker:resting-heart-rate", 57, "bpm"),
    point("2026-04-29", "hrv-rmssd", "biomarker:hrv-rmssd", 72, "ms"),
    point("2026-04-29", "deep-sleep-minutes", "biomarker:deep-sleep-minutes", 81, "minutes"),
    point("2026-04-29", "rem-sleep-minutes", "biomarker:rem-sleep-minutes", 94, "minutes"),
  ];
  const metricRows = toBrowserVaultMetricRows({ points });
  const metricSelectionRows = createBrowserVaultMetricSelectionRows({
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricPoints: points,
    requestedMetrics: [
      { metricKey: "resting-heart-rate", biomarkerKey: "biomarker:resting-heart-rate" },
      { metricKey: "hrv-rmssd", biomarkerKey: "biomarker:hrv-rmssd" },
      { metricKey: "deep-sleep-minutes", biomarkerKey: "biomarker:deep-sleep-minutes" },
      { metricKey: "rem-sleep-minutes", biomarkerKey: "biomarker:rem-sleep-minutes" },
      { metricKey: "apob", biomarkerKey: "biomarker:apob" },
    ],
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(createReplica({ metricRows, metricSelectionRows })));

  assert.deepEqual(metricRows.map((row) => row.metricKey).sort(), [
    "deep-sleep-minutes",
    "hrv-rmssd",
    "rem-sleep-minutes",
    "resting-heart-rate",
    "resting-heart-rate",
  ]);

  assert.equal(client.metricSelections.getByBiomarker("biomarker:resting-heart-rate")?.value, 57);
  assert.equal(client.metricSelections.getByBiomarker("biomarker:apob")?.status, "no_data");
  assert.equal(client.metricSelections.getByBiomarker("biomarker:apob")?.selectedMetricRowId, null);
  assert.equal(client.metricSelections.get("resting-heart-rate")?.id, "metric-selection:resting-heart-rate:biomarker:resting-heart-rate");
  assert.equal(client.metrics.series({ metricKey: "resting-heart-rate" }).at(-1)?.value, 57);
  assert.deepEqual(client.metrics.seriesMany([{ metricKey: "hrv-rmssd" }, { metricKey: "deep-sleep-minutes" }]).map((series) => series.at(-1)?.value), [72, 81]);
});

test("browser-vault biomarker selection prefers the primary metric when secondary metrics share a biomarker", () => {
  const points: MetricPoint[] = [
    point("2026-04-29", "lowest-spo2", "biomarker:blood-oxygen-spo2", 91.2, "percent"),
    point("2026-04-29", "spo2", "biomarker:blood-oxygen-spo2", 97.1, "percent"),
  ];
  const metricRows = toBrowserVaultMetricRows({ points });
  const metricSelectionRows = createBrowserVaultMetricSelectionRows({
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricPoints: points,
    requestedMetrics: [
      { metricKey: "lowest-spo2", biomarkerKey: "biomarker:blood-oxygen-spo2" },
      { metricKey: "spo2", biomarkerKey: "biomarker:blood-oxygen-spo2" },
    ],
  });
  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(createReplica({
    metricRows,
    metricSelectionRows,
  })));

  assert.equal(client.metricSelections.getByBiomarker("biomarker:blood-oxygen-spo2")?.metricKey, "spo2");
  assert.equal(client.metricSelections.get("lowest-spo2")?.value, 91.2);
});

function point(date: string, metricKey: string, biomarkerKey: string | null, value: number, unit: string): MetricPoint {
  return {
    biomarkerKey,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: date,
    grain: "day",
    id: `metric-point:${metricKey}:${date}`,
    metricKey,
    observedAt: `${date}T00:00:00.000Z`,
    provenance: { dataOrigin: null, externalRef: null, labName: null, provider: null, rawRefs: [], sourceLabel: "Wearable summary" },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: { family: "derived", kind: "wearable-summary", path: "", recordId: `record:${metricKey}:${date}`, resultIndex: null },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}

function createReplica(overrides: Partial<BrowserVaultReplica> = {}): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: { dataVersion: "sha256:browser-vault-metric-points-test", sourceBundleHash: "sha256:browser-vault-metric-points-source" },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
    ...overrides,
  };
}
