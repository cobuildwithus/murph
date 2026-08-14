import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import type { ResultsTabExperiment } from "@/src/components/experiments/experiment-detail/results-tab";
import type { BrowserVaultContextValue } from "@/src/lib/browser-vault/context";
import type { ExperimentRunProjection } from "@/src/types/experiments";

type ResolvePrivateRunByIdInput = {
  client: BrowserVaultContextValue["client"];
  experimentId: string;
};

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  resolveBrowserVaultExperimentRunById: vi.fn(
    (input: ResolvePrivateRunByIdInput): ExperimentRunProjection | null => {
      void input;
      return null;
    },
  ),
  resultsTab: vi.fn((props: {
    experiment: ResultsTabExperiment;
    showFinishedOutcomeSummary?: boolean;
    showHeader?: boolean;
  }) =>
    createElement("div", { "data-results-title": props.experiment.title })
  ),
  useBrowserVault: vi.fn(),
  useBrowserVaultExperimentMetricBucketDemand: vi.fn(() => true),
}));

vi.mock("next/link", () => ({
  default({ children, href }: { children?: ReactNode; href: string }) {
    return createElement("a", { href }, children);
  },
}));

vi.mock("@/src/components/experiments/experiment-detail/results-tab", () => ({
  ResultsTab: mocks.resultsTab,
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  isBrowserVaultMetricsCapable: (client: unknown) => client !== null,
  useBrowserVault: mocks.useBrowserVault,
  useBrowserVaultExperimentMetricBucketDemand:
    mocks.useBrowserVaultExperimentMetricBucketDemand,
}));

vi.mock("@/src/lib/browser-vault/experiment-run", () => ({
  resolveBrowserVaultExperimentRunById: mocks.resolveBrowserVaultExperimentRunById,
}));

import { PrivateRunResultsClient } from "../app/(dashboard)/experiments/runs/[experimentId]/private-run-results-client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBrowserVaultExperimentRunById.mockReturnValue(null);
  mocks.useBrowserVault.mockReturnValue(browserVaultContext({
    client: null,
    error: null,
    status: "empty",
  }));
});

test("resolves the route by exact private experiment id and renders its result projection", () => {
  const privateRun = createPrivateRun();
  mocks.resolveBrowserVaultExperimentRunById.mockReturnValue(privateRun);
  mocks.useBrowserVault.mockReturnValue(browserVaultContext({
    client: null,
    error: null,
    status: "ready",
  }));

  const markup = renderToStaticMarkup(
    createElement(PrivateRunResultsClient, { experimentId: "exp:private-run" }),
  );

  assert.equal(
    mocks.resolveBrowserVaultExperimentRunById.mock.calls[0]?.[0]?.experimentId,
    "exp:private-run",
  );
  assert.equal(
    mocks.resolveBrowserVaultExperimentRunById.mock.calls[0]?.[0]?.client,
    null,
  );
  const experiment = mocks.resultsTab.mock.calls[0]?.[0]?.experiment;
  assert.equal(experiment?.privateRun, privateRun);
  assert.equal(experiment?.baselineDays, 3);
  assert.equal(experiment?.durationDays, 14);
  assert.equal(experiment?.outcomeConfidence, "low");
  assert.equal(
    mocks.resultsTab.mock.calls[0]?.[0]?.showFinishedOutcomeSummary,
    false,
  );
  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.showHeader, false);
  assert.match(markup, /Private run title/u);
  assert.match(markup, /Completed.*Started Jul 1, 2026.*Saved privately in your vault/u);
  assert.doesNotMatch(markup, /max-w-6xl/u);
  assert.doesNotMatch(markup, /mx-auto/u);
});

test("keeps an unknown private duration absent from the results view", () => {
  const privateRun = createPrivateRun();
  privateRun.durationDays = undefined;
  privateRun.status = "active";
  privateRun.statusLabel = "Active";
  mocks.resolveBrowserVaultExperimentRunById.mockReturnValue(privateRun);
  mocks.useBrowserVault.mockReturnValue(browserVaultContext({
    client: null,
    error: null,
    status: "ready",
  }));

  renderToStaticMarkup(
    createElement(PrivateRunResultsClient, { experimentId: "exp:private-run" }),
  );

  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.experiment.durationDays, undefined);
});

test("keeps an absent private id inside the authenticated vault surface", () => {
  const markup = renderToStaticMarkup(
    createElement(PrivateRunResultsClient, { experimentId: "missing-run" }),
  );

  assert.match(markup, /Experiment not found/u);
  assert.match(markup, /current vault snapshot/u);
  assert.match(markup, /href="\/home"/u);
  assert.equal(mocks.resultsTab.mock.calls.length, 0);
});

test("renders the vault loading state before declaring a private run absent", () => {
  mocks.useBrowserVault.mockReturnValue(browserVaultContext({
    client: null,
    error: null,
    status: "loading",
  }));

  const markup = renderToStaticMarkup(
    createElement(PrivateRunResultsClient, { experimentId: "exp:pending" }),
  );

  assert.match(markup, /Loading your experiment/u);
  assert.doesNotMatch(markup, /Experiment not found/u);
});

function browserVaultContext(
  overrides: Partial<BrowserVaultContextValue>,
): BrowserVaultContextValue {
  return {
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: null,
    refresh: mocks.refresh,
    refreshPending: false,
    runtimeRefreshPending: false,
    status: "empty",
    workspaceVersion: null,
    ...overrides,
  };
}

function createPrivateRun(): ExperimentRunProjection {
  return {
    baselineDays: 3,
    durationDays: 14,
    id: "exp:private-run",
    outcomeStatus: "available",
    outcomeConfidence: "low",
    signals: [],
    slug: "private-run",
    snapshotGeneratedAt: "2026-07-20T12:00:00.000Z",
    source: "browser-vault",
    startedOn: "2026-07-01",
    status: "finished",
    statusLabel: "Completed",
    tags: [],
    timingKnown: true,
    timeline: [],
    title: "Private run title",
    trends: [],
  };
}
