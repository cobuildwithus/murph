import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import type { ExperimentCardData } from "@/src/lib/experiments/share-card";
import { resolveHealthCommonsExperimentResultsPublic } from "@/src/lib/health-commons/experiment-projections";
import type { ExperimentRunProjection } from "@/src/types/experiments";

const mocks = vi.hoisted(() => ({
  cardData: null as ExperimentCardData | null,
  resolveBrowserVaultExperimentRun: vi.fn((): ExperimentRunProjection | null => null),
  useBrowserVault: vi.fn(),
}));

vi.mock("@/src/components/experiments/experiment-detail/results-summary", () => ({
  ResultsSummary: () => createElement("div"),
  ResultsSummarySkeleton: () => createElement("div"),
}));

vi.mock("@/src/components/experiments/experiment-detail/share-results-card", () => ({
  ShareResultsCard({ cardData }: { cardData: ExperimentCardData }) {
    mocks.cardData = cardData;
    return createElement("div", { "data-share-card": cardData.title });
  },
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  isBrowserVaultMetricsCapable: () => true,
  useBrowserVault: mocks.useBrowserVault,
  useBrowserVaultExperimentMetricBucketDemand: () => true,
}));

vi.mock("@/src/lib/browser-vault/experiment-run", () => ({
  buildBrowserVaultExperimentResultLookups: () => ({
    experimentIds: [],
    protocolKeys: [],
    slugs: [],
  }),
  resolveBrowserVaultExperimentRun: mocks.resolveBrowserVaultExperimentRun,
}));

import { ActiveRunSummaryClient } from "../app/(dashboard)/experiments/[experimentId]/active-run-summary-client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cardData = null;
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    status: "ready",
  });
});

test("uses the saved run duration in the private share artifact after catalog timing changes", () => {
  const protocol = resolveHealthCommonsExperimentResultsPublic("finnish-sauna");
  assert.ok(protocol);
  assert.equal(protocol.durationDays, 28);

  mocks.resolveBrowserVaultExperimentRun.mockReturnValue(createPrivateRun({
    durationDays: 21,
    timingKnown: true,
  }));

  renderToStaticMarkup(createElement(ActiveRunSummaryClient, {
    protocol,
    protocolFacts: [],
  }));

  assert.ok(mocks.cardData);
  assert.equal(mocks.cardData.title, `21-day ${protocol.title}`);
  assert.notEqual(mocks.cardData.title, `28-day ${protocol.title}`);
});

test("omits duration from a share artifact when the saved timing is incomplete", () => {
  const protocol = resolveHealthCommonsExperimentResultsPublic("finnish-sauna");
  assert.ok(protocol);

  mocks.resolveBrowserVaultExperimentRun.mockReturnValue(createPrivateRun({
    durationDays: undefined,
    timingKnown: false,
  }));

  renderToStaticMarkup(createElement(ActiveRunSummaryClient, {
    protocol,
    protocolFacts: [],
  }));

  assert.ok(mocks.cardData);
  assert.equal(mocks.cardData.title, protocol.title);
});

function createPrivateRun(
  timing: Pick<ExperimentRunProjection, "durationDays" | "timingKnown">,
): ExperimentRunProjection {
  return {
    baselineDays: 7,
    durationDays: timing.durationDays,
    id: "exp_saved_7_plus_14",
    outcomeStatus: "pending",
    signals: [{
      baseline: "62 bpm",
      delta: "-4 bpm",
      direction: "down",
      expected: "Lower",
      label: "Resting heart rate",
      sentiment: "positive",
      value: "58",
      unit: "bpm",
    }],
    slug: "finnish-sauna",
    snapshotGeneratedAt: "2026-07-22T12:00:00.000Z",
    source: "browser-vault",
    startedOn: "2026-06-01",
    status: "active",
    statusLabel: "Active",
    tags: [],
    timeline: [],
    timingKnown: timing.timingKnown,
    title: "Saved sauna run",
    trends: [],
  };
}
