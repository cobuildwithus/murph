import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  type BrowserVaultMetricRow,
  type BrowserVaultMetricSelectionRow,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { act, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
  useBrowserVaultMetricKeyDemand: vi.fn(() => true),
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: ReactNode }) => createElement("section", { "data-browser-vault-provider": true }, children),
  isBrowserVaultMetricsCapable: (client: unknown) => client !== null,
  useBrowserVault: mocks.useBrowserVault,
  useBrowserVaultMetricKeyDemand: mocks.useBrowserVaultMetricKeyDemand,
}));

import { BiomarkerOverview } from "@/src/components/biomarkers/biomarker-detail/biomarker-overview";
import { BiomarkerPrivateTrendCard } from "@/src/components/biomarkers/biomarker-detail/biomarker-private-trend-card";
import { resolveHealthCommonsBiomarkerOverview } from "@/src/lib/health-commons/biomarker-projections";

beforeEach(() => {
  mocks.useBrowserVault.mockReset();
  mocks.useBrowserVaultMetricKeyDemand.mockReset();
  mocks.useBrowserVaultMetricKeyDemand.mockReturnValue(true);
});

test("renders and retries a required bucket error instead of leaving the trend loading", async () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);
  const refresh = vi.fn(async () => {});
  mocks.useBrowserVaultMetricKeyDemand.mockReturnValue(false);
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: "Browser vault failed",
    ref: null,
    refresh,
    status: "error",
  });

  const rendered = await renderClientComponent(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
    { requireButton: false },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Browser vault failed/u);
    assert.doesNotMatch(rendered.container.innerHTML, /animate-pulse/u);
    const retry = [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry private trend",
    );
    assert.ok(retry);
    await act(async () => {
      retry.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(refresh.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
});

test("does not render mocked private biomarker values when browser-vault is unavailable", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);

  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "empty",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /Biomarker unavailable/u);
  assert.match(markup, /Connect a health device/u);
  assert.match(markup, /Connect a device/u);
  assert.doesNotMatch(markup, /demo wearable/iu);
  assert.doesNotMatch(markup, /Latest Demo/iu);
});

test("the biomarker overview mounts the browser-vault private card", () => {
  const source = readFileSync(
    new URL("../src/components/biomarkers/biomarker-detail/biomarker-overview.tsx", import.meta.url),
    "utf8",
  );
  const layoutSource = readFileSync(
    new URL(
      "../app/(dashboard)/biomarkers/[biomarkerId]/biomarker-layout-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const dashboardLayoutSource = readFileSync(
    new URL("../app/(dashboard)/layout.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /BiomarkerPrivateTrendCard/u);
  // The persistent dashboard layout provider owns the browser vault, so the
  // overview mounts the consumer directly without a route-local provider.
  assert.doesNotMatch(source, /BrowserVaultProvider/u);
  assert.match(dashboardLayoutSource, /BrowserVaultProvider/u);
  assert.doesNotMatch(layoutSource, /BrowserVaultProvider/u);
  assert.doesNotMatch(source, /BiomarkerTrendDetail/u);
});

test("the biomarker overview uses a concise experiments section heading", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);

  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "empty",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerOverview, { biomarker }),
  );

  assert.match(markup, />Experiments</u);
  assert.doesNotMatch(markup, /Experiments that may move your/u);
});

test("the biomarker overview lets the metric catalog decide private trend support", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);
  const unsupportedBiomarker = {
    ...biomarker,
    key: "biomarker:unsupported-private-trend-fixture",
    privateMetricBindings: [],
    shortName: "Unsupported",
    title: "Unsupported Private Trend Fixture",
  };

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica()),
    dataVersion: "sha256:browser-vault-private-card-test",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerOverview, { biomarker: unsupportedBiomarker }),
  );

  assert.match(markup, /Biomarker unavailable/u);
  assert.doesNotMatch(markup, /Connect a health device/u);
});

test("renders private trend values from the browser-vault selector", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);
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

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows,
      metricSelectionRows: [metricSelectionFromRows(metricRows, {
        effectiveDate: "2026-04-28",
        observedAt: "2026-04-28T00:00:00.000Z",
        value: 56,
        valueLabel: "56",
      })],
      sourceHealthRows: [
        {
          activityDays: 0,
          bodyStateDays: 0,
          conflictCount: 0,
          firstDate: "2026-03-23",
          lastDate: "2026-04-29",
          latestRecordedAt: "2026-04-29",
          provider: "oura",
          providerDisplayName: "Oura Ring",
          recoveryDays: 12,
          selectedMetrics: 12,
          sleepNights: 0,
          stalenessVsNewestDays: 0,
        },
      ],
    })),
    dataVersion: "sha256:browser-vault-private-card-test",
    deviceSyncImportPending: true,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /Latest/u);
  assert.match(markup, />56</u);
  assert.match(markup, /Wearable Summary/u);
  assert.doesNotMatch(markup, /Oura Ring/u);
  assert.doesNotMatch(markup, /WHOOP/u);
  assert.match(markup, /7-day average/u);
  assert.match(markup, /30d avg/u);
  assert.doesNotMatch(markup, /Still importing private data/u);
  assert.doesNotMatch(markup, /Wearable data is still importing/u);
  assert.match(markup, /text-muted-foreground">↓/u);
  assert.doesNotMatch(markup, /text-amber-600">↓/u);
  assert.doesNotMatch(markup, /demo wearable/iu);
});

test("does not label lab values with an unrelated sole wearable source", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);
  const metricRows = metricRowsForTest({
    biomarkerKey: biomarker.key,
    metricKey: "resting-heart-rate",
    rows: [
      ["2026-04-23", 56],
      ["2026-04-24", 57],
      ["2026-04-25", 55],
      ["2026-04-26", 56],
      ["2026-04-27", 57],
    ],
    sourceLabel: "clinic vitals from April annual exam",
    unit: "bpm",
  });

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows,
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
    })),
    dataVersion: "sha256:browser-vault-private-card-test",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /Clinic Vitals From April Annual Exam/u);
  assert.match(
    markup,
    /title="Clinic Vitals From April Annual Exam · Apr 27"/u,
  );
  assert.match(markup, /class="[^"]*truncate[^"]*text-xs[^"]*"/u);
  assert.doesNotMatch(markup, /WHOOP/u);
});

test("keeps chart rows from becoming private current values without a selector row", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows: restingHeartRateRows([
        ["2026-04-28", 56],
        ["2026-04-29", 57],
      ]),
      metricSelectionRows: [],
    })),
    dataVersion: "sha256:browser-vault-private-card-test",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /No current value yet/u);
  assert.match(markup, /no current value is available yet/u);
  assert.doesNotMatch(markup, />57</u);
  assert.doesNotMatch(markup, /Connect a device/u);
});

test("renders private trend values for catalog-supported biomarker keys", () => {
  const scenarios = [
    {
      metricKey: "spo2",
      routeId: "blood-oxygen-spo2",
      rows: [
        ["2026-04-25", 96.4],
        ["2026-04-26", 96.8],
        ["2026-04-27", 96.9],
        ["2026-04-28", 97],
        ["2026-04-29", 97.1],
      ],
      unit: "percent",
      valuePattern: />97\.1</u,
    },
    {
      metricKey: "estimated-vo2-max",
      routeId: "estimated-vo2max",
      rows: [
        ["2026-04-15", 42.1],
        ["2026-04-29", 42.4],
      ],
      unit: "mL/kg/min",
      valuePattern: />42\.4</u,
    },
  ] as const;

  for (const scenario of scenarios) {
    const biomarker = resolveHealthCommonsBiomarkerOverview(scenario.routeId);
    assert.ok(biomarker);

    mocks.useBrowserVault.mockReturnValue({
      client: createBrowserVaultQueryClient(createReplica({
        metricRows: metricRowsForTest({
          biomarkerKey: biomarker.key,
          metricKey: scenario.metricKey,
          rows: scenario.rows,
          unit: scenario.unit,
        }),
      })),
      dataVersion: "sha256:browser-vault-private-card-test",
      error: null,
      ref: null,
      refresh: async () => {},
      status: "ready",
    });

    const markup = renderToStaticMarkup(
      createElement(BiomarkerPrivateTrendCard, { biomarker }),
    );

    assert.match(markup, scenario.valuePattern);
    assert.match(markup, /7-day average/u);
    assert.doesNotMatch(markup, /Biomarker unavailable/u);
  }
});

test("renders secondary private biomarker metrics from Health Commons bindings", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("blood-oxygen-spo2");
  assert.ok(biomarker);
  const averageRows = metricRowsForTest({
    biomarkerKey: biomarker.key,
    metricKey: "spo2",
    rows: [
      ["2026-04-25", 96.4],
      ["2026-04-26", 96.8],
      ["2026-04-27", 96.9],
      ["2026-04-28", 97],
      ["2026-04-29", 97.1],
    ],
    unit: "percent",
  });
  const minimumRows = metricRowsForTest({
    biomarkerKey: biomarker.key,
    metricKey: "lowest-spo2",
    rows: [
      ["2026-04-25", 92.8],
      ["2026-04-26", 93.1],
      ["2026-04-27", 92.4],
      ["2026-04-28", 91.9],
      ["2026-04-29", 91.2],
    ],
    unit: "percent",
  });

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows: [...averageRows, ...minimumRows],
      metricSelectionRows: [
        metricSelectionFromRows(averageRows),
        metricSelectionFromRows(minimumRows, {
          status: "stale",
          warnings: [{ code: "SOURCE_STALE", message: "Source is stale." }],
        }),
      ],
    })),
    dataVersion: "sha256:browser-vault-private-card-test",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /Latest/u);
  assert.match(markup, />97\.1</u);
  assert.match(markup, /Lowest blood oxygen/u);
  assert.match(markup, />91\.2</u);
  assert.match(markup, /Out of date/u);
  assert.match(markup, />%<\/span>/u);
  assert.doesNotMatch(markup, /Biomarker unavailable/u);
});

test("renders the insufficient-data state from real browser-vault rows", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);
  const metricRows = restingHeartRateRows([
    ["2026-04-28", 56],
    ["2026-04-29", 57],
  ]);

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows,
      metricSelectionRows: [metricSelectionFromRows(metricRows, { status: "insufficient_data", value: null, valueLabel: null })],
    })),
    dataVersion: "sha256:browser-vault-private-card-test",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /Not enough private data yet/u);
  assert.match(markup, /Found 2 points/u);
  assert.doesNotMatch(markup, /Connect a device/u);
  assert.doesNotMatch(markup, /demo wearable/iu);
});

test("renders importing copy when pending device data may fill an insufficient trend", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);
  const metricRows = restingHeartRateRows([
    ["2026-04-28", 56],
    ["2026-04-29", 57],
  ]);

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows,
      metricSelectionRows: [metricSelectionFromRows(metricRows, { status: "insufficient_data", value: null, valueLabel: null })],
    })),
    dataVersion: "sha256:browser-vault-private-card-test",
    deviceSyncImportPending: true,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /Still importing private data/u);
  assert.match(markup, /Wearable data is still importing\. This trend may fill in shortly\./u);
  assert.match(markup, /Found 2 points so far/u);
  assert.doesNotMatch(markup, /Connect a device/u);
  assert.doesNotMatch(markup, /Murph waits for at least/u);
});

test("renders a no-data state when the browser-vault replica has no matching rows", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica()),
    dataVersion: "sha256:browser-vault-private-card-test",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /No private values yet/u);
  assert.match(markup, /No RHR values saved on this device yet/u);
  assert.match(markup, /Connect a device/u);
  assert.doesNotMatch(markup, /demo wearable/iu);
});

test("renders importing copy when pending device data may fill an empty trend", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica()),
    dataVersion: "sha256:browser-vault-private-card-test",
    deviceSyncImportPending: true,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker }),
  );

  assert.match(markup, /Still importing private data/u);
  assert.match(markup, /Wearable data is still importing\. This trend may fill in shortly\./u);
  assert.doesNotMatch(markup, /Connect a device/u);
  assert.doesNotMatch(markup, /No private values yet/u);
});

test("renders an unsupported state for biomarkers without browser-vault metric bindings", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);
  const unsupportedBiomarker = {
    ...biomarker,
    key: "biomarker:unsupported-private-trend-fixture",
    privateMetricBindings: [],
    shortName: "Unsupported",
    title: "Unsupported Private Trend Fixture",
  };

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica()),
    dataVersion: "sha256:browser-vault-private-card-test",
    deviceSyncImportPending: true,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker: unsupportedBiomarker }),
  );

  assert.match(markup, /Biomarker unavailable/u);
  assert.match(markup, /Private tracking for this biomarker is not available yet/u);
  assert.doesNotMatch(markup, /Still importing private data/u);
  assert.doesNotMatch(markup, /Connect a device/u);
});

function restingHeartRateRows(rows: readonly (readonly [string, number])[]): BrowserVaultMetricRow[] {
  return metricRowsForTest({
    biomarkerKey: "biomarker:resting-heart-rate",
    metricKey: "resting-heart-rate",
    rows,
    unit: "bpm",
  });
}

function metricRowsForTest(input: {
  biomarkerKey: string;
  metricKey: string;
  rows: readonly (readonly [string, number])[];
  sourceLabel?: string;
  unit: string;
}): BrowserVaultMetricRow[] {
  return input.rows.map(([date, value]) => ({
    biomarkerKey: input.biomarkerKey,
    confidence: "high",
    context: {},
    date,
    grain: "day",
    id: `metric-row:${input.metricKey}:${date}`,
    metricKey: input.metricKey,
    observedAt: `${date}T00:00:00.000Z`,
    pointIds: [`metric-point:${input.metricKey}:${date}`],
    recordIds: [],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "derived",
    sourceKind: "wearable-summary",
    sourceLabel: input.sourceLabel ?? "Wearable summary",
    statistic: "value",
    unit: input.unit,
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
  const metricRows = overrides.metricRows ?? [];
  const hasMetricSelectionRows = Object.prototype.hasOwnProperty.call(overrides, "metricSelectionRows");
  const metricSelectionRows = hasMetricSelectionRows
    ? overrides.metricSelectionRows ?? []
    : metricRows.length > 0
      ? [metricSelectionFromRows(metricRows)]
      : [];

  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: [],
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricGoalProgressRows: [],
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
      dataVersion: "sha256:browser-vault-private-card-test",
      sourceBundleHash: "sha256:browser-vault-private-card-source",
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
    labResultRows: overrides.labResultRows ?? [],
    metricRows,
    metricSelectionRows,
  };
}
