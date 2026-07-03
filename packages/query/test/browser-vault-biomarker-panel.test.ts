import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  selectBrowserVaultBiomarkerPanel,
  type BrowserVaultMetricRow,
  type BrowserVaultMetricSelectionRow,
  type BrowserVaultReplica,
} from "../src/browser.ts";

test("returns no_private_vault when no browser-vault client is available", () => {
  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: "biomarker:resting-heart-rate",
    client: null,
    generatedAt: "2026-04-30T12:00:00.000Z",
    label: "RHR",
    trendDefaults: trendDefaults(),
    unit: "bpm",
    valuePrecision: 0,
  });

  assert.equal(panel.status, "no_private_vault");
  assert.equal(panel.primary, null);
  assert.equal(panel.privacy.defaultShare, "private");
  assert.match(panel.emptyState?.body ?? "", /Your data stays private/u);
});

test("builds a ready biomarker panel from browser-vault metric selections and rows", () => {
  const metricRows = restingHeartRateRows([
    ["2026-03-23", 62],
    ["2026-03-24", 61],
    ["2026-03-25", 63],
    ["2026-03-26", 62],
    ["2026-03-27", 61],
    ["2026-03-28", 62],
    ["2026-04-23", 58],
    ["2026-04-24", 57],
    ["2026-04-25", 58],
    ["2026-04-26", 56],
    ["2026-04-27", 57],
    ["2026-04-28", 56],
    ["2026-04-29", 57],
  ]);
  const client = createBrowserVaultQueryClient(
    createReplica({
      metricRows,
      metricSelectionRows: [metricSelectionFromRows(metricRows)],
    }),
  );

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: "biomarker:resting-heart-rate",
    client,
    label: "RHR",
    now: "2026-04-30T12:00:00.000Z",
    trendDefaults: trendDefaults(),
    unit: "bpm",
    valuePrecision: 0,
  });

  assert.equal(panel.status, "ready");
  assert.equal(panel.schema, "murph.browser-vault-biomarker-panel");
  assert.equal(panel.primary?.latest?.value, 57);
  assert.equal(panel.primary?.sampleCount, 13);
  assert.equal(panel.primary?.trend?.direction, "down");
  assert.equal(panel.primary?.trend?.label, "7-day median vs prior 30 days");
  assert.equal(panel.sources[0]?.displayName, "WHOOP");
  assert.equal("provider" in (panel.sources[0] ?? {}), false);
});

test("does not promote chart series rows to a current value without a metric selection", () => {
  const metricRows = restingHeartRateRows([
    ["2026-04-28", 56],
    ["2026-04-29", 57],
  ]);
  const client = createBrowserVaultQueryClient(createReplica({ metricRows }));

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: "biomarker:resting-heart-rate",
    client,
    label: "RHR",
    now: "2026-04-30T12:00:00.000Z",
    trendDefaults: trendDefaults(),
    unit: "bpm",
    valuePrecision: 0,
  });

  assert.equal(client.metrics.series({ metricKey: "resting-heart-rate" }).at(-1)?.value, 57);
  assert.equal(panel.status, "missing_selection");
  assert.equal(panel.primary?.latest, null);
  assert.equal(panel.primary?.sampleCount, 2);
  assert.match(panel.emptyState?.body ?? "", /no current value is available yet/u);
});

test("returns insufficient_data before the biomarker minimum point threshold", () => {
  const metricRows = restingHeartRateRows([
    ["2026-04-28", 56],
    ["2026-04-29", 57],
  ]);
  const client = createBrowserVaultQueryClient(
    createReplica({
      metricRows,
      metricSelectionRows: [metricSelectionFromRows(metricRows, { status: "insufficient_data", value: null, valueLabel: null })],
    }),
  );

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: "biomarker:resting-heart-rate",
    client,
    label: "RHR",
    now: "2026-04-30T12:00:00.000Z",
    trendDefaults: trendDefaults(),
    unit: "bpm",
    valuePrecision: 0,
  });

  assert.equal(panel.status, "insufficient_data");
  assert.equal(panel.primary?.sampleCount, 2);
  assert.equal(panel.warnings.some((warning) => warning.code === "LOW_SAMPLE_COUNT"), true);
});

test("returns no_data when the browser-vault replica has no rows for the bound metric", () => {
  const client = createBrowserVaultQueryClient(createReplica());

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: "biomarker:resting-heart-rate",
    client,
    label: "RHR",
    now: "2026-04-30T12:00:00.000Z",
    trendDefaults: trendDefaults(),
    unit: "bpm",
    valuePrecision: 0,
  });

  assert.equal(panel.status, "no_data");
  assert.equal(panel.primary, null);
  assert.match(panel.emptyState?.body ?? "", /No RHR values/u);
  assert.equal(panel.sources[0]?.displayName, "WHOOP");
});

test("returns unsupported for biomarker pages without a metric-catalog mapping", () => {
  const client = createBrowserVaultQueryClient(createReplica());

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: "biomarker:self-reported-mood",
    client,
    label: "Mood",
    now: "2026-04-30T12:00:00.000Z",
    trendDefaults: trendDefaults(),
    unit: "score",
    valuePrecision: 0,
  });

  assert.equal(panel.status, "unsupported");
  assert.equal(panel.primary, null);
});

test("uses stale metric selection state while keeping the selected value", () => {
  const metricRows = restingHeartRateRows([
    ["2026-04-01", 62],
    ["2026-04-02", 61],
    ["2026-04-03", 63],
    ["2026-04-04", 62],
    ["2026-04-05", 61],
  ]);
  const client = createBrowserVaultQueryClient(
    createReplica({
      metricRows,
      metricSelectionRows: [metricSelectionFromRows(metricRows, {
        status: "stale",
        warnings: [{ code: "SOURCE_STALE", message: "Latest RHR value is older than 7 days." }],
      })],
    }),
  );

  const panel = selectBrowserVaultBiomarkerPanel({
    biomarkerKey: "biomarker:resting-heart-rate",
    client,
    label: "RHR",
    now: "2026-04-30T12:00:00.000Z",
    staleAfterDays: 7,
    trendDefaults: trendDefaults(),
    unit: "bpm",
    valuePrecision: 0,
  });

  assert.equal(panel.status, "stale");
  assert.equal(panel.primary?.latest?.date, "2026-04-05");
  assert.equal(panel.warnings.some((warning) => warning.code === "SOURCE_STALE"), true);
});

function trendDefaults() {
  return {
    aggregation: "median",
    comparisonWindowDays: 30,
    latestWindowDays: 7,
    minimumPoints: 5,
  } as const;
}

function restingHeartRateRows(rows: readonly (readonly [string, number])[]): BrowserVaultMetricRow[] {
  return rows.map(([date, value]) => ({
    biomarkerKey: "biomarker:resting-heart-rate",
    confidence: "high",
    context: {},
    date,
    grain: "day",
    id: `metric-row:resting-heart-rate:${date}`,
    metricKey: "resting-heart-rate",
    observedAt: `${date}T00:00:00.000Z`,
    pointIds: [`metric-point:resting-heart-rate:${date}`],
    recordIds: [],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "derived",
    sourceKind: "wearable-summary",
    sourceLabel: "Wearable summary",
    statistic: "value",
    unit: "bpm",
    value,
    valueLabel: String(value),
  }));
}

function metricSelectionFromRows(
  rows: readonly BrowserVaultMetricRow[],
  overrides: Partial<BrowserVaultMetricSelectionRow> = {},
): BrowserVaultMetricSelectionRow {
  const latest = rows.at(-1);
  if (!latest) throw new Error("Expected at least one metric row.");
  const biomarkerKey = latest.biomarkerKey;
  return {
    biomarkerKey,
    confidence: latest.confidence,
    effectiveDate: latest.date,
    id: `metric-selection:${latest.metricKey}:${biomarkerKey ?? "none"}`,
    metricKey: latest.metricKey,
    observedAt: latest.observedAt,
    pointIds: latest.pointIds,
    recordIds: latest.recordIds,
    selectedMetricRowId: latest.id,
    selectionSchema: "murph.browser-vault.metric-selection.v1",
    sourceLabel: latest.sourceLabel,
    status: "ready",
    unit: latest.unit,
    value: latest.value,
    valueLabel: latest.valueLabel,
    warnings: [],
    ...overrides,
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
    source: {
      dataVersion: "sha256:browser-vault-biomarker-panel-test",
      sourceBundleHash: "sha256:browser-vault-biomarker-panel-source",
    },
    sourceHealthRows: [
      {
        activityDays: 0,
        bodyStateDays: 0,
        conflictCount: 0,
        firstDate: "2026-03-23",
        lastDate: "2026-04-29",
        latestRecordedAt: "2026-04-29",
        provider: "whoop",
        providerDisplayName: "WHOOP",
        recoveryDays: 12,
        selectedMetrics: 12,
        sleepNights: 0,
        stalenessVsNewestDays: 0,
      },
    ],
    timelineRows: [],
    weeklySampleSummaries: [],
    ...overrides,
  };
}
