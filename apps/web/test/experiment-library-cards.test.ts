import assert from "node:assert/strict";

import { test } from "vitest";
import type { OverviewExperiment } from "@murphai/query/browser-overview";
import {
  BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  type BrowserVaultReplica,
} from "@murphai/query/browser-replica-client";

import { CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION } from "@/src/lib/experiments/experiment-detail";
import {
  buildExperimentLibraryCards,
  buildHomeExperimentLibraryCards,
} from "@/src/lib/experiments/library-cards";
import type { ExperimentProtocol } from "@/src/types/experiments";

test("buildExperimentLibraryCards maps tracked run statuses to runStatus and badge variant", () => {
  const cards = buildExperimentLibraryCards({
    client: null,
    protocols: [],
    trackedExperiments: [
      trackedExperiment({ id: "exp:running", status: " Running ", title: "Running run" }),
      trackedExperiment({ id: "exp:paused", status: "paused", title: "Paused run" }),
      trackedExperiment({ id: "exp:closed", status: "closed", title: "Closed run" }),
      trackedExperiment({ id: "exp:archived", status: "archived", title: "Archived run" }),
    ],
  });

  const byId = new Map(cards.map((card) => [card.id, card]));

  assert.equal(byId.get("exp:running")?.runStatus, "active");
  assert.equal(byId.get("exp:running")?.statusVariant, "default");
  assert.equal(byId.get("exp:running")?.href, "/experiments/runs/exp%3Arunning");
  assert.equal(byId.get("exp:paused")?.runStatus, "paused");
  assert.equal(byId.get("exp:paused")?.statusVariant, "secondary");
  assert.equal(byId.get("exp:closed")?.runStatus, "stopped");
  assert.equal(byId.get("exp:closed")?.statusVariant, "destructive");
  // Unknown tracked statuses keep the pre-extraction "outline" badge and read as finished runs.
  assert.equal(byId.get("exp:archived")?.runStatus, "finished");
  assert.equal(byId.get("exp:archived")?.statusVariant, "outline");
});

test("buildExperimentLibraryCards keeps protocol-only cards public and sorts private runs first", () => {
  const cards = buildExperimentLibraryCards({
    client: null,
    protocols: [createProtocol()],
    trackedExperiments: [
      trackedExperiment({ id: "exp:tracked", status: "active", title: "Tracked run" }),
    ],
  });

  // "Finnish Dry Sauna" sorts before "Tracked run" alphabetically, so private-first wins here.
  assert.deepEqual(cards.map((card) => card.id), ["exp:tracked", "sauna-protocol"]);

  const protocolCard = cards[1];
  assert.equal(protocolCard?.hasPrivateData, false);
  assert.equal(protocolCard?.runStatus, undefined);
  assert.equal(protocolCard?.statusVariant, undefined);
  assert.equal(protocolCard?.href, "/experiments/sauna-protocol");
  assert.equal(cards[0]?.href, "/experiments/runs/exp%3Atracked");
});

test("buildHomeExperimentLibraryCards decorates one matching public card without a private-only duplicate", () => {
  const tracked = trackedExperiment({
    id: "exp:sauna-run",
    status: "active",
    title: "My sauna run",
  });
  const cards = buildHomeExperimentLibraryCards({
    client: createProjectedClient(),
    protocols: [createProtocol()],
    trackedExperiments: [tracked],
  });

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.id, "sauna-protocol");
  assert.equal(cards[0]?.trackedExperimentId, "exp:sauna-run");
  assert.equal(cards[0]?.privateBadgeLabel, "Private data");
  assert.equal(cards[0]?.href, "/experiments/sauna-protocol");
});

function createProjectedClient() {
  return createBrowserVaultQueryClient({
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    experimentRunCards: [{
      id: "exp:sauna-run",
      lookupKeys: {
        experimentIds: ["exp:sauna-run"],
        protocolKeys: [],
        slugs: ["sauna-protocol"],
      },
      runSummary: { metrics: [] },
      requiredMetricBuckets: [],
      schema: BROWSER_VAULT_EXPERIMENT_RUN_CARD_SCHEMA,
      slug: "sauna-protocol",
      startedOn: "2026-06-01",
      status: "active",
      statusLabel: "Active",
      summary: "Protocol in progress",
      summaryDetail: null,
      tags: ["sauna"],
      title: "My sauna run",
    }],
    generatedAt: "2026-06-03T12:00:00.000Z",
    hasLabBiomarkers: false,
    labResultRows: [],
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
    source: { dataVersion: "test", sourceBundleHash: "test" },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  } satisfies BrowserVaultReplica);
}

function trackedExperiment(input: {
  id: string;
  status: string | null;
  title: string;
}): OverviewExperiment {
  return {
    analysisPlan: null,
    assistantSupport: null,
    commonsProtocolRef: null,
    effectiveProtocolSnapshot: null,
    id: input.id,
    onboarding: null,
    outcome: null,
    outcomeRef: null,
    protocolRef: null,
    runPlan: null,
    slug: null,
    startedOn: null,
    status: input.status,
    summary: null,
    tags: [],
    title: input.title,
  };
}

function createProtocol(): ExperimentProtocol {
  return {
    baselineDays: 7,
    category: "Recovery",
    description: "Simple heat exposure experiment.",
    durationDays: 21,
    evidenceLabel: "Field testing · Usable",
    evidenceLevel: 3,
    expectedSignals: [],
    experts: [],
    id: "sauna-protocol",
    image: "/design-assets/hero-sauna.png",
    measurementPaths: [],
    mechanismChain: [],
    protocol: [],
    protocolContractVersion: CURRENT_EXPERIMENT_PROTOCOL_CONTRACT_VERSION,
    protocolFacts: [],
    protocolKeepInMind: [],
    protocolLogFields: [],
    protocolTips: [],
    researchStats: [],
    researchSummaryLabel: "81 studies",
    safety: {
      cautionLevel: 3,
      precautions: [],
      whoShouldAvoid: [],
    },
    studies: [],
    studyCount: 81,
    title: "Finnish Dry Sauna",
    whyItWorks: "Heat load can act as a stressor.",
  };
}
