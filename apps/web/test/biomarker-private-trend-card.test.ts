import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: ReactNode }) => createElement("section", { "data-browser-vault-provider": true }, children),
  useBrowserVault: mocks.useBrowserVault,
}));

import { BiomarkerOverview } from "@/src/components/biomarkers/biomarker-detail/biomarker-overview";
import { BiomarkerPrivateTrendCard } from "@/src/components/biomarkers/biomarker-detail/biomarker-private-trend-card";
import { resolveHealthCommonsBiomarkerOverview } from "@/src/lib/health-commons/biomarker-projections";

beforeEach(() => {
  mocks.useBrowserVault.mockReset();
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
    new URL("../app/biomarkers/[biomarkerId]/biomarker-layout-client.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /BiomarkerPrivateTrendCard/u);
  assert.match(source, /BrowserVaultProvider/u);
  assert.doesNotMatch(layoutSource, /BrowserVaultProvider/u);
  assert.doesNotMatch(source, /BiomarkerTrendDetail/u);
});

test("the biomarker overview lets the metric catalog decide private trend support", () => {
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

  const unsupportedBiomarker = {
    ...biomarker,
    privateMetricBindings: [],
    shortName: "Mood",
  };
  const markup = renderToStaticMarkup(
    createElement(BiomarkerOverview, { biomarker: unsupportedBiomarker }),
  );

  assert.match(markup, /data-browser-vault-provider/u);
  assert.match(markup, /Biomarker unavailable/u);
  assert.doesNotMatch(markup, /Connect a health device/u);
});

test("renders private trend values from the browser-vault selector", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows: restingHeartRateRows([
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
      ]),
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

  assert.match(markup, /Your RHR trend/u);
  assert.match(markup, />57</u);
  assert.match(markup, /WHOOP/u);
  assert.match(markup, /7-day median vs prior 30 days/u);
  assert.match(markup, /Murph compares this to your own recent baseline/u);
  assert.doesNotMatch(markup, /demo wearable/iu);
});

test("renders the insufficient-data state from real browser-vault rows", () => {
  const biomarker = resolveHealthCommonsBiomarkerOverview("resting-heart-rate");
  assert.ok(biomarker);

  mocks.useBrowserVault.mockReturnValue({
    client: createBrowserVaultQueryClient(createReplica({
      metricRows: restingHeartRateRows([
        ["2026-04-28", 56],
        ["2026-04-29", 57],
      ]),
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
  assert.match(markup, /No RHR values were found in the current browser-vault snapshot/u);
  assert.match(markup, /Connect a device/u);
  assert.doesNotMatch(markup, /demo wearable/iu);
});

test("renders an unsupported state for biomarkers without browser-vault metric bindings", () => {
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

  const unsupportedBiomarker = {
    ...biomarker,
    privateMetricBindings: [],
    shortName: "Mood",
  };
  const markup = renderToStaticMarkup(
    createElement(BiomarkerPrivateTrendCard, { biomarker: unsupportedBiomarker }),
  );

  assert.match(markup, /Biomarker unavailable/u);
  assert.match(markup, /Private tracking for this biomarker is not available yet/u);
  assert.doesNotMatch(markup, /Connect a device/u);
});

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
    rowSchema: "murph.browser-vault.metric-row",
    sourceFamily: "derived",
    sourceKind: "wearable-summary",
    sourceLabel: "Wearable summary",
    statistic: "value",
    unit: "bpm",
    value,
    valueLabel: String(value),
  }));
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
  };
}
