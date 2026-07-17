import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  parseBrowserVaultReplica,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
} from "../src/browser.ts";
import { selectBrowserVaultDeviceMetricSummary } from "../src/browser-biomarkers.ts";

test("only wearable-derived rows decide the device summary", () => {
  const client = clientWithMetricRows([
    metricRow({ date: "2026-07-10", id: "w1", sourceKind: "wearable-summary", value: 61 }),
    metricRow({ date: "2026-07-14", id: "w2", sourceKind: "wearable-summary", value: 59 }),
    // Newer manual and lab rows for the same metric must not become the
    // latest value, count, or span under a device heading.
    metricRow({ date: "2026-07-15", id: "m1", sourceKind: "observation", value: 70 }),
    metricRow({ date: "2026-07-15", id: "m2", sourceKind: "measurement", value: 71 }),
    metricRow({ date: "2026-07-13", id: "t1", sourceKind: "test-result", value: 75 }),
  ]);

  const summary = selectBrowserVaultDeviceMetricSummary(client, "resting-heart-rate");
  assert.ok(summary);
  assert.equal(summary.readingCount, 2);
  assert.equal(summary.latest.value, 59);
  assert.equal(summary.latest.date, "2026-07-14");
  assert.equal(summary.firstDate, "2026-07-10");
  assert.equal(summary.stale, false);
});

test("manual-only, lab-only, and empty histories produce no device summary", () => {
  const manualOnly = clientWithMetricRows([
    metricRow({ date: "2026-07-14", id: "m1", sourceKind: "observation", value: 62 }),
    metricRow({ date: "2026-07-15", id: "m2", sourceKind: "measurement", value: 63 }),
  ]);
  assert.equal(selectBrowserVaultDeviceMetricSummary(manualOnly, "resting-heart-rate"), null);

  const labOnly = clientWithMetricRows([
    metricRow({ date: "2026-07-14", id: "t1", sourceKind: "test-result", value: 64 }),
  ]);
  assert.equal(selectBrowserVaultDeviceMetricSummary(labOnly, "resting-heart-rate"), null);

  const empty = clientWithMetricRows([]);
  assert.equal(selectBrowserVaultDeviceMetricSummary(empty, "resting-heart-rate"), null);

  const unknownKind = clientWithMetricRows([
    metricRow({ date: "2026-07-14", id: "u1", sourceKind: null, value: 64 }),
  ]);
  assert.equal(selectBrowserVaultDeviceMetricSummary(unknownKind, "resting-heart-rate"), null);
});

test("sleep and activity summaries count as device readings", () => {
  const client = clientWithMetricRows([
    metricRow({ date: "2026-06-01", id: "s1", sourceKind: "sleep-summary", value: 48 }),
    metricRow({ date: "2026-06-05", id: "a1", sourceKind: "activity-summary", value: 52 }),
  ]);

  const summary = selectBrowserVaultDeviceMetricSummary(client, "resting-heart-rate");
  assert.ok(summary);
  assert.equal(summary.readingCount, 2);
  assert.equal(summary.latest.date, "2026-06-05");
});

test("staleness follows each metric definition's own freshness policy", () => {
  // Resting heart rate stales after 14 calendar days per its selection
  // policy; the replica is generated 2026-07-16.
  const rhrAt = (date: string) =>
    selectBrowserVaultDeviceMetricSummary(
      clientWithMetricRows([
        metricRow({ date, id: `rhr-${date}`, sourceKind: "wearable-summary", value: 60 }),
      ]),
      "resting-heart-rate",
    );
  assert.equal(rhrAt("2026-07-08")?.stale, false);
  assert.equal(rhrAt("2026-07-02")?.stale, false);
  assert.equal(rhrAt("2026-07-01")?.stale, true);

  // Estimated VO2 max stales after 45 days, so a reading far past the
  // recovery-metric window stays current.
  const vo2At = (date: string) =>
    selectBrowserVaultDeviceMetricSummary(
      clientWithMetricRows([
        metricRow({
          date,
          id: `vo2-${date}`,
          metricKey: "estimated-vo2-max",
          sourceKind: "activity-summary",
          unit: "mL/kg/min",
          value: 41,
        }),
      ]),
      "estimated-vo2-max",
    );
  assert.equal(vo2At("2026-07-08")?.stale, false);
  assert.equal(vo2At("2026-06-01")?.stale, false);
  assert.equal(vo2At("2026-05-31")?.stale, true);
});

function clientWithMetricRows(metricRows: BrowserVaultMetricRow[]) {
  return createBrowserVaultQueryClient(parseBrowserVaultReplica(createReplica(metricRows)));
}

function metricRow(
  overrides: Partial<BrowserVaultMetricRow> & {
    date: string;
    id: string;
    sourceKind: string | null;
    value: number | null;
  },
): BrowserVaultMetricRow {
  return {
    biomarkerKey: "biomarker:resting-heart-rate",
    comparator: null,
    confidence: "high",
    context: {},
    grain: "day",
    metricKey: "resting-heart-rate",
    observedAt: `${overrides.date}T07:00:00.000Z`,
    pointIds: [],
    recordIds: [],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "derived",
    sourceLabel: "wearable",
    statistic: "mean",
    unit: "bpm",
    valueLabel: null,
    ...overrides,
  };
}

function createReplica(metricRows: BrowserVaultMetricRow[]): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-07-16T12:00:00.000Z",
    labResultRows: [],
    metricGoalProgressRows: [],
    metricRows,
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
      dataVersion: "sha256:device-metrics-test",
      sourceBundleHash: "f".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}
