import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import {
  decodeExperimentCardData,
  encodeExperimentCardData,
  type ExperimentCardData,
} from "@/src/lib/experiments/share-card";
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
  useBrowserVault: mocks.useBrowserVault,
}));

vi.mock("@/src/lib/browser-vault/experiment-run", () => ({
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

test("encodes the saved run duration in the share artifact after catalog timing changes", () => {
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
  const decoded = decodeExperimentCardData(encodeExperimentCardData(mocks.cardData));
  assert.equal(decoded?.title, `21-day ${protocol.title}`);
  assert.notEqual(decoded?.title, `28-day ${protocol.title}`);
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
  const decoded = decodeExperimentCardData(encodeExperimentCardData(mocks.cardData));
  assert.equal(decoded?.title, protocol.title);
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
