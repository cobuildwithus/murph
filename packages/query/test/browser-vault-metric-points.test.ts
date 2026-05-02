import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultMetricPoints,
  createBrowserVaultMetricSelectionRows,
  createBrowserVaultQueryClient,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
} from "../src/browser.ts";

test("projects wearable RHR/HRV/deep/REM metric rows into metric points and selections", () => {
  const metricRows: BrowserVaultMetricRow[] = [
    wearableMetricRow("2026-04-28", "recovery", "restingHeartRate", 58, "bpm"),
    wearableMetricRow("2026-04-29", "recovery", "restingHeartRate", 57, "bpm"),
    wearableMetricRow("2026-04-29", "recovery", "hrv", 72, "ms"),
    wearableMetricRow("2026-04-29", "sleep", "deepMinutes", 81, "minutes"),
    wearableMetricRow("2026-04-29", "sleep", "remMinutes", 94, "minutes"),
  ];
  const metricPoints = createBrowserVaultMetricPoints(metricRows);
  const metricSelectionRows = createBrowserVaultMetricSelectionRows({
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricPoints,
  });
  const client = createBrowserVaultQueryClient(createReplica({
    metricPoints,
    metricRows,
    metricSelectionRows,
  }));

  assert.deepEqual(metricPoints.map((point) => point.metricKey).sort(), [
    "deep-sleep-minutes",
    "hrv-rmssd",
    "rem-sleep-minutes",
    "resting-heart-rate",
    "resting-heart-rate",
  ]);

  const rhr = client.metricSelections.getByBiomarker("biomarker:resting-heart-rate");
  assert.equal(rhr?.value, 57);
  assert.equal(rhr?.valueLabel, "57");
  assert.equal(rhr?.unit, "bpm");
  assert.equal(rhr?.status, "ready");

  assert.equal(client.metricSelections.get("resting-heart-rate")?.id, "metric-selection:resting-heart-rate");
  assert.equal(client.metricPoints.series({ metricKey: "resting-heart-rate" }).at(-1)?.value, 57);
  assert.equal(client.metricSelections.getByBiomarker("biomarker:hrv-rmssd")?.value, 72);
  assert.equal(client.metricSelections.getByBiomarker("biomarker:deep-sleep-minutes")?.value, 81);
  assert.equal(client.metricSelections.getByBiomarker("biomarker:rem-sleep-minutes")?.value, 94);
});

function wearableMetricRow(
  date: string,
  domain: BrowserVaultMetricRow["domain"],
  metric: string,
  value: number,
  unit: string,
): BrowserVaultMetricRow {
  return {
    confidence: "high",
    date,
    domain,
    id: `${domain}:${date}:${metric}`,
    metric,
    recordIds: [`record:${domain}:${date}:${metric}`],
    sourceFamily: "derived",
    sourceKind: "summary",
    unit,
    value,
  };
}

function createReplica(overrides: Partial<BrowserVaultReplica> = {}): BrowserVaultReplica {
  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: [],
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricDayRows: [],
    metricPoints: [],
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
    source: {
      dataVersion: "sha256:browser-vault-metric-points-test",
      sourceBundleHash: "sha256:browser-vault-metric-points-source",
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
    ...overrides,
  };
}
