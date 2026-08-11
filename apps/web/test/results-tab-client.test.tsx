import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import type {
  ResultsTabExperiment,
} from "@/src/components/experiments/experiment-detail/results-tab";
import type { BrowserVaultContextValue } from "@/src/lib/browser-vault/context";
import { resolveHealthCommonsExperimentResultsPublic } from "@/src/lib/health-commons/experiment-projections";
import type {
  ExperimentRunProjection,
} from "@/src/types/experiments";

type ResultsTabMockProps = {
  experiment: ResultsTabExperiment;
  onPrivateRunRetry?: () => unknown;
  privateRunError: string | null;
  privateRunStatus: string;
};

type ResolvePrivateRunInput = {
  client: BrowserVaultContextValue["client"];
  protocol: unknown;
};

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  resolveBrowserVaultExperimentRun: vi.fn(
    (input: ResolvePrivateRunInput): ExperimentRunProjection | null => {
      void input;
      return null;
    },
  ),
  resultsTab: vi.fn((props: ResultsTabMockProps) =>
    createElement(
      "div",
      null,
      `${props.privateRunStatus}|${props.privateRunError ?? "no-error"}|${props.experiment.privateRun ? "private" : "no-private"}`,
    )
  ),
  useBrowserVault: vi.fn(),
}));

vi.mock("@/src/components/experiments/experiment-detail/results-tab", () => ({
  ResultsTab: mocks.resultsTab,
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault: mocks.useBrowserVault,
}));

vi.mock("@/src/lib/browser-vault/experiment-run", () => ({
  resolveBrowserVaultExperimentRun: mocks.resolveBrowserVaultExperimentRun,
}));

import { ResultsTabClient } from "../app/(dashboard)/experiments/[experimentId]/results/results-tab-client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBrowserVaultExperimentRun.mockReturnValue(null);
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: "Browser vault failed",
    freshness: "fresh",
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    runtimeRefreshPending: false,
    status: "error",
    workspaceVersion: null,
  } satisfies BrowserVaultContextValue);
});

test("passes browser-vault loading errors and retry ownership to the results view", () => {
  const protocol = resolveHealthCommonsExperimentResultsPublic("finnish-sauna");
  assert.ok(protocol);

  const markup = renderToStaticMarkup(
    createElement(ResultsTabClient, { protocol }),
  );

  assert.equal(markup, "<div>error|Browser vault failed|no-private</div>");
  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.privateRunStatus, "error");
  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.privateRunError, "Browser vault failed");
  assert.equal(mocks.resultsTab.mock.calls[0]?.[0]?.onPrivateRunRetry, mocks.refresh);
  assert.equal(mocks.resolveBrowserVaultExperimentRun.mock.calls[0]?.[0]?.client, null);
});

test("keeps a completed run and its context visible instead of applying the active-run filter", () => {
  const protocol = resolveHealthCommonsExperimentResultsPublic("finnish-sauna");
  assert.ok(protocol);

  const privateRun: ExperimentRunProjection = {
    id: "run_completed",
    outcomeStatus: "available",
    source: "browser-vault",
    snapshotGeneratedAt: "2026-06-30T12:00:00.000Z",
    slug: "finnish-sauna",
    status: "finished",
    statusLabel: "Completed",
    startedOn: "2026-06-01",
    tags: [],
    timingKnown: true,
    title: protocol.title,
    signals: [],
    trends: [],
    timeline: [],
    sessionContext: [{
      confounders: ["travel"],
      date: "2026-06-08",
      id: "context_1",
      kind: "context",
      note: "Schedule changed",
      symptoms: [],
    }],
    summary: "Completed result",
  };
  mocks.resolveBrowserVaultExperimentRun.mockReturnValue(privateRun);
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: "v1",
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    runtimeRefreshPending: false,
    status: "ready",
    workspaceVersion: "v1",
  } satisfies BrowserVaultContextValue);

  renderToStaticMarkup(createElement(ResultsTabClient, { protocol }));

  const experiment = mocks.resultsTab.mock.calls[0]?.[0]?.experiment;
  assert.equal(experiment?.status, "finished");
  assert.equal(experiment?.privateRun, privateRun);
  assert.deepEqual(experiment?.sessionContext, privateRun.sessionContext);
  assert.equal(experiment?.summary, "Completed result");
});
