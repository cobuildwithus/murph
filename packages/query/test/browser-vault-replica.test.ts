import assert from "node:assert/strict";

import {
  computeHabitatCoverage,
  experimentOutcomeSchema,
  type ExperimentOutcome,
  type HabitatIndicatorValue,
} from "@murphai/contracts";
import { test } from "vitest";

import type { MetricPoint } from "../src/metrics/index.ts";
import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  getBrowserVaultMetricBucketId,
  hashBrowserVaultReplicaData,
  parseBrowserVaultReplica,
  selectBrowserVaultExperimentResults,
  selectBrowserVaultExperimentMetricKeys,
  selectBrowserVaultHistory,
  selectBrowserVaultOverview,
  selectBrowserVaultTrackedExperiments,
} from "../src/browser.ts";
import { analyzeExperimentOutcome, buildMetricProjection } from "../src/index.ts";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];
type CreateReplicaInput = Omit<Parameters<typeof createBrowserVaultReplica>[0], "metricPoints">;

async function createBrowserVaultReplicaFromVault(input: CreateReplicaInput) {
  return createBrowserVaultReplica({
    ...input,
    metricPoints: buildMetricProjection(input.vault).metricPoints,
  });
}

test("browser vault replicas round-trip and expose the query-client selectors", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_1", {
          body: "# Trial\n\nShort walks are helping with afternoon energy.\n",
          date: "2026-04-18",
          experimentSlug: "light-morning-walk",
          occurredAt: "2026-04-18T08:00:00.000Z",
          status: "active",
          tags: ["movement"],
          title: "Morning walk",
        }),
        createEntity("journal", "journal_1", {
          body: "# Note\n\nFelt steadier after a full night of sleep.\n",
          date: "2026-04-20",
          occurredAt: "2026-04-20T07:30:00.000Z",
          tags: ["sleep", "travel"],
          title: "Travel recovery note",
        }),
        createEntity("sample", "sample_1", {
          attributes: {
            unit: "min",
            value: 430,
          },
          date: "2026-04-20",
          occurredAt: "2026-04-20T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
        createEntity("sample", "sample_2", {
          attributes: {
            unit: "min",
            value: 400,
          },
          date: "2026-04-13",
          occurredAt: "2026-04-13T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  assert.equal(replica.schema, BROWSER_VAULT_REPLICA_SCHEMA);
  assert.equal(replica.generation, BROWSER_VAULT_REPLICA_CURRENT_GENERATION);
  assert.equal(replica.source.sourceBundleHash, "a".repeat(64));
  assert.match(replica.source.dataVersion, /^[0-9a-f]{64}$/u);

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const overview = selectBrowserVaultOverview(client);
  const history = selectBrowserVaultHistory(client);

  assert.equal(selectBrowserVaultTrackedExperiments(client)[0]?.title, "Morning walk");
  assert.equal(overview.recentJournals[0]?.title, "Travel recovery note");
  assert.ok(history.timeline.some((entry) => entry.title === "Travel recovery note"));
  assert.equal(client.entities.get("exp_1")?.title, "Morning walk");
  assert.ok(client.search("steadier").some((row) => row.entityId === "journal_1"));
});

test("exact experiment metric demand is not bounded by the 24-card display projection", async () => {
  const overflowIndex = 24;
  const experiments = Array.from({ length: 25 }, (_, index) => {
    const day = String(25 - index).padStart(2, "0");
    const id = index === overflowIndex ? "run_overflow" : `run_${index}`;
    const slug = index === overflowIndex ? "overflow-protocol-slug" : `protocol-${index}`;
    const commonsKey = index === overflowIndex ? "overflow-public-protocol" : `public-${index}`;
    const frontmatter = {
      analysisPlan: {
        desiredDirection: "decrease",
        primaryBiomarkerKey: "biomarker:resting-heart-rate",
      },
      commonsProtocolRef: { key: commonsKey },
      runPlan: {
        baselineEnd: "2026-03-07",
        baselineStart: "2026-03-01",
        interventionEnd: "2026-03-14",
        interventionStart: "2026-03-08",
      },
      startedOn: "2026-03-01",
      status: "active",
    };
    return createEntity("experiment", id, {
      date: `2026-04-${day}`,
      experimentSlug: slug,
      frontmatter,
      kind: "experiment",
      occurredAt: `2026-04-${day}T12:00:00.000Z`,
      status: "active",
      title: `Experiment ${index}`,
    });
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-30T12:00:00.000Z",
    metricPoints: [createMetricPoint({
      biomarkerKey: "biomarker:resting-heart-rate",
      effectiveDate: "2026-03-10",
      metricKey: "resting-heart-rate",
      recordId: "overflow-rhr",
      unit: "bpm",
      value: 60,
    })],
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: experiments,
      metadata: null,
      vaultRoot: "browser://experiment-overflow",
    }),
  });
  const client = createBrowserVaultQueryClient(replica);
  const expectedBucket = await getBrowserVaultMetricBucketId("resting-heart-rate");

  assert.equal(replica.experimentRunCards?.length, 24);
  assert.equal(replica.experimentRunCards?.some((card) => card.id === "run_overflow"), false);
  assert.deepEqual(
    selectBrowserVaultExperimentMetricKeys(client, { experimentId: "run_overflow" }),
    ["resting-heart-rate"],
  );
  assert.deepEqual(
    selectBrowserVaultExperimentMetricKeys(client, { slug: "overflow-protocol-slug" }),
    ["resting-heart-rate"],
  );
  assert.deepEqual(
    selectBrowserVaultExperimentMetricKeys(client, {
      protocolKeys: ["overflow-public-protocol"],
    }),
    ["resting-heart-rate"],
  );
  assert.equal(
    selectBrowserVaultExperimentMetricKeys(client, { experimentId: "absent-run" }),
    null,
  );
  assert.equal(replica.experimentRunCards?.every((card) =>
    card.requiredMetricBuckets.length === 1
    && card.requiredMetricBuckets[0] === expectedBucket
  ), true);
});

test("browser vault replicas preserve habitat facts for coverage derivation", async () => {
  const indicators = {
    darkness: "blackout",
    night_temp_c: 19,
  } satisfies Record<string, HabitatIndicatorValue>;
  const indicatorRecordedAt = {
    darkness: "2026-04-20T06:00:00.000Z",
    night_temp_c: "2026-04-20T06:00:00.000Z",
  };
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "h".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("habitat", "hab_sleep", {
          attributes: {
            aspect: "sleep-environment",
            domain: "environment",
            indicators,
            indicatorRecordedAt,
            note: "Bedroom runs cool and dark.",
          },
          frontmatter: {
            aspect: "sleep-environment",
            domain: "environment",
            indicators,
            indicatorRecordedAt,
            note: "Bedroom runs cool and dark.",
          },
          kind: "habitat",
          path: "bank/habitat/sleep-environment.md",
          status: "active",
          title: "Bedroom & sleep",
        }),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const habitat = client.entities.get("hab_sleep");

  assert.ok(habitat);
  assert.equal(habitat.family, "habitat");
  assert.deepEqual(habitat.attributes.indicators, indicators);
  assert.deepEqual(habitat.attributes.indicatorRecordedAt, indicatorRecordedAt);

  const coverage = computeHabitatCoverage([{
    aspect: requireStringAttribute(habitat.attributes.aspect, "habitat aspect"),
    indicatorRecordedAt: requireStringRecord(
      habitat.attributes.indicatorRecordedAt,
      "habitat indicatorRecordedAt",
    ),
    indicators: requireHabitatIndicators(habitat.attributes.indicators),
  }], { now: "2026-04-20T12:00:00.000Z" });
  const sleepCoverage = coverage.domains
    .flatMap((domain) => domain.aspects)
    .find((aspect) => aspect.aspectId === "sleep-environment");

  assert.equal(
    sleepCoverage?.indicators.find((indicator) => indicator.indicatorId === "night_temp_c")?.status,
    "known",
  );
  assert.equal(
    sleepCoverage?.indicators.find((indicator) => indicator.indicatorId === "darkness")?.status,
    "known",
  );
});

test("browser vault overview experiment summary is uncapped and completed-status specific", async () => {
  const activeExperiments = Array.from({ length: 25 }, (_, index) => {
    const day = String(30 - index).padStart(2, "0");
    return createEntity("experiment", `active_${index}`, {
      date: `2026-05-${day}`,
      occurredAt: `2026-05-${day}T08:00:00.000Z`,
      status: "active",
      title: `Active ${index}`,
    });
  });
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-05-31T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        ...activeExperiments,
        createEntity("experiment", "done_old", {
          date: "2026-04-02",
          occurredAt: "2026-04-02T08:00:00.000Z",
          status: "done",
          title: "Finished repeat",
        }),
        createEntity("experiment", "completed_old", {
          date: "2026-04-01",
          occurredAt: "2026-04-01T08:00:00.000Z",
          status: "completed",
          title: "Finished hydration",
        }),
        createEntity("experiment", "paused_old", {
          date: "2026-03-31",
          occurredAt: "2026-03-31T08:00:00.000Z",
          status: "paused",
          title: "Paused baseline",
        }),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });
  const overview = selectBrowserVaultOverview(createBrowserVaultQueryClient(replica));

  assert.equal(overview.trackedExperiments.length, 24);
  assert.equal(overview.experimentSummary.activeCount, 25);
  assert.equal(overview.experimentSummary.activePreview.length, 4);
  assert.equal(overview.experimentSummary.completedCount, 2);
  assert.equal(overview.experimentSummary.latestCompleted?.title, "Finished repeat");
  assert.equal(
    overview.trackedExperiments.some((entry) => entry.id === "done_old"),
    false,
  );
});

test("browser vault replica dataVersion stays stable when only generatedAt changes", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEntity("journal", "journal_1", {
        body: "Kept the baseline ordinary.",
        title: "Baseline note",
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });

  const first = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });
  const second = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-21T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });

  assert.equal(first.source.dataVersion, second.source.dataVersion);
});

test("browser vault replica dataVersion changes when only sourceBundleHash changes", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEntity("journal", "journal_1", {
        body: "Kept the baseline ordinary.",
        title: "Baseline note",
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });

  const first = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });
  const second = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "c".repeat(64),
    vault,
  });

  assert.notEqual(first.source.dataVersion, second.source.dataVersion);
});

test("browser vault replica generation is content-addressed and legacy-readable", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "g".repeat(64),
    vault: createVaultReadModel({
      entities: [],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const legacyReplica: Record<string, unknown> = { ...replica };
  delete legacyReplica.generation;

  assert.equal(parseBrowserVaultReplica(legacyReplica).generation, undefined);
  assert.notEqual(
    await hashBrowserVaultReplicaData(replica),
    await hashBrowserVaultReplicaData({
      ...replica,
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION + 1,
    }),
  );
  assert.throws(
    () => parseBrowserVaultReplica({ ...replica, generation: 0 }),
    /generation must be a positive safe integer/u,
  );
  assert.throws(
    () => parseBrowserVaultReplica({ ...replica, generation: Number.MAX_SAFE_INTEGER + 1 }),
    /generation must be a positive safe integer/u,
  );
});

test("browser vault query client freezes the exposed replica graph", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "e".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("journal", "journal_1", {
          attributes: {
            mood: "steady",
          },
          body: "A stable private note.",
          title: "Private note",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const entity = client.replica.entities[0];
  assert.ok(entity);

  assert.equal(Object.isFrozen(client.replica), true);
  assert.equal(Object.isFrozen(client.replica.entities), true);
  assert.equal(Object.isFrozen(entity), true);
  assert.equal(Object.isFrozen(entity.attributes), true);
  assert.throws(() => {
    entity.title = "Mutated";
  }, TypeError);
});

test("browser vault replicas validate schema", () => {
  assert.throws(
    () => parseBrowserVaultReplica({
      schema: "murph.browser-vault-replica.wrong",
    }),
    /Browser vault replica\.schema must be murph\.browser-vault-replica\./u,
  );
});

test("browser vault replicas validate and round-trip canonical experiment outcomes", async () => {
  const outcome = createExperimentOutcome();
  const replica = await createBrowserVaultReplicaFromVault({
    experimentOutcomes: [outcome],
    generatedAt: "2027-06-20T12:00:00.000Z",
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  assert.deepEqual(parseBrowserVaultReplica(replica).experimentOutcomes, [outcome]);
});

test("legacy outcomes stay immutable while results show current daily measurements", async () => {
  const experimentId = "exp_01ARZ3NDEKTSV4RRFFQ69G5FAW";
  const slug = "legacy-saved-time-evidence";
  const frontmatter = {
    schemaVersion: "murph.frontmatter.experiment.v1" as const,
    docType: "experiment" as const,
    experimentId,
    slug,
    title: "Legacy saved-time evidence",
    status: "completed" as const,
    startedOn: "2026-04-01",
    endedOn: "2026-04-04",
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-02",
      interventionStart: "2026-04-03",
      interventionEnd: "2026-04-04",
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:deep-sleep-minutes",
      desiredDirection: "increase" as const,
    },
    outcome: {
      latestOutcomeId: `${experimentId}-outcome-2026-04-04`,
      finalAnalysisStatus: "generated" as const,
    },
    outcomeRef: {
      generatedAt: "2026-04-05T12:00:00.000Z",
      outcomeId: `${experimentId}-outcome-2026-04-04`,
      relativePath: `bank/experiments/outcomes/${slug}-2026-04-04.json`,
    },
  };
  const vault = createVaultReadModel({
    entities: [
      createEntity("experiment", experimentId, {
        attributes: frontmatter,
        experimentSlug: slug,
        frontmatter,
        kind: "experiment",
        status: "completed",
        title: frontmatter.title,
      }),
    ],
    metadata: null,
    vaultRoot: "browser://legacy-saved-time-evidence",
  });
  const originalPoints = [
    ["2026-04-01", 60],
    ["2026-04-02", 62],
    ["2026-04-03", 70],
    ["2026-04-04", 72],
  ].map(([effectiveDate, value], index) => ({
    ...createMetricPoint({
      biomarkerKey: "biomarker:deep-sleep-minutes",
      effectiveDate: String(effectiveDate),
      metricKey: "deep-sleep-minutes",
      recordId: `original-${index}`,
      unit: "minutes",
      value: Number(value),
    }),
    id: `metric-point:original-${index}`,
    recordedAt: `${String(effectiveDate)}T12:00:00.000Z`,
  }));
  const analyzed = analyzeExperimentOutcome(vault, slug, {
    asOf: "2026-04-04",
    metricPoints: originalPoints,
  });
  const legacyOutcome = experimentOutcomeSchema.parse({
    ...analyzed,
    generatedAt: "2026-04-05T12:00:00.000Z",
    schema: "murph.experiment-outcome.v1",
    schemaVersion: "murph.experiment-outcome.v1",
    metricResults: analyzed.metricResults.map(({ points: _points, ...metric }) => {
      void _points;
      return metric;
    }),
  });
  const currentValues = [160, 162, 170, 172];
  const currentPoints = originalPoints.map((point, index) => {
    const value = currentValues[index];
    if (value === undefined) {
      throw new Error("Expected one current value for each original point.");
    }
    return {
      ...point,
      canonicalValue: value,
      context: {
        ...point.context,
        contributingRecordIds: [`current-${index}`],
      },
      id: `metric-point:current-${index}`,
      recordedAt: "2026-04-06T12:00:00.000Z",
      source: {
        ...point.source,
        recordId: `current-${index}`,
      },
      value,
    };
  });
  const replica = await createBrowserVaultReplica({
    experimentOutcomes: [legacyOutcome],
    generatedAt: "2026-04-07T12:00:00.000Z",
    metricPoints: currentPoints,
    sourceBundleHash: "b".repeat(64),
    vault,
  });

  const persistedOutcome = replica.experimentOutcomes?.[0];
  assert.deepEqual(persistedOutcome, legacyOutcome);
  assert.deepEqual(replica.experimentRunCards?.[0]?.runSummary.metric, {
    baseline: "61 minutes",
    biomarkerKey: "biomarker:deep-sleep-minutes",
    current: "71 minutes",
    label: "Deep Sleep Minutes",
  });
  assert.deepEqual(replica.experimentRunCards?.[0]?.runSummary.metrics, []);
  assert.deepEqual(replica.experimentRunCards?.[0]?.requiredMetricBuckets, [
    await getBrowserVaultMetricBucketId("deep-sleep-minutes"),
  ]);
  const results = selectBrowserVaultExperimentResults(
    createBrowserVaultQueryClient(replica),
    { experimentId },
  );
  assert.ok(results);
  assert.equal(results.persistedOutcome?.schemaVersion, "murph.experiment-outcome.v1");
  assert.equal(results.biomarkers[0]?.baseline.mean, 61);
  assert.deepEqual(
    results.biomarkers[0]?.points.map((point) => point.value),
    currentValues,
  );
});

test("browser vault parser defaults legacy replicas without outcomes to an empty list", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2027-06-20T12:00:00.000Z",
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const legacyReplica = { ...replica };
  delete legacyReplica.experimentOutcomes;
  delete legacyReplica.experimentRunCards;
  delete legacyReplica.hasLabBiomarkers;

  assert.deepEqual(parseBrowserVaultReplica(legacyReplica).experimentOutcomes, []);
  assert.deepEqual(parseBrowserVaultReplica(legacyReplica).experimentRunCards, []);
  assert.equal(parseBrowserVaultReplica(legacyReplica).hasLabBiomarkers, false);
});

test("browser vault replica keeps metric adherence targets", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "c".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_adherence", {
          frontmatter: {
            runPlan: {
              baselineStart: "2026-04-01",
              baselineEnd: "2026-04-07",
              interventionStart: "2026-04-08",
              interventionEnd: "2026-04-14",
              adherenceTargets: [
                {
                  targetId: "sauna",
                  label: "Sauna",
                  phase: "intervention",
                  calendar: {
                    kind: "daily",
                    timeZone: "America/New_York",
                  },
                  evidence: {
                    kind: "linkedEventCount",
                    eventKind: "intervention_session",
                    missing: "missed_after_grace",
                  },
                },
                {
                  targetId: "steps",
                  label: "Step floor",
                  phase: "intervention",
                  calendar: {
                    kind: "daily",
                    timeZone: "America/New_York",
                  },
                  evidence: {
                    kind: "metricThreshold",
                    metricKey: "steps",
                    op: ">=",
                    value: 8000,
                    missing: "unknown",
                  },
                },
              ],
            },
          },
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const experiment = parseBrowserVaultReplica(replica).entities[0];
  const runPlan = experiment?.attributes.runPlan;
  assert.ok(runPlan && typeof runPlan === "object" && !Array.isArray(runPlan));
  const targets = (runPlan as Record<string, unknown>).adherenceTargets;
  assert.ok(Array.isArray(targets));
  assert.equal(targets.length, 2);
  assert.equal((targets[0] as Record<string, unknown>).targetId, "sauna");
  assert.equal((targets[1] as Record<string, unknown>).targetId, "steps");
});

test("browser vault replica does not request custom metric rows for unsupported adherence targets", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_custom_metric_adherence", {
          frontmatter: {
            runPlan: {
              baselineStart: "2026-04-01",
              baselineEnd: "2026-04-07",
              interventionStart: "2026-04-08",
              interventionEnd: "2026-04-14",
              adherenceTargets: [{
                targetId: "custom-score",
                label: "Custom score",
                phase: "intervention",
                calendar: {
                  kind: "daily",
                  timeZone: "UTC",
                },
                evidence: {
                  kind: "metricThreshold",
                  metricKey: "custom-reaction-time",
                  op: "<=",
                  value: 300,
                  missing: "unknown",
                },
              }],
            },
          },
        }),
        createEntity("sample", "smp_custom_reaction_time", {
          attributes: {
            metric: "custom-reaction-time",
            source: "manual",
            unit: "ms",
            value: 280,
          },
          kind: "metric_sample",
          occurredAt: "2026-04-08T08:00:00.000Z",
          path: "ledger/metric-samples/custom-reaction-time/2026/2026-04.jsonl",
          stream: "custom-reaction-time",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  assert.equal(replica.metricRows.some((row) =>
    row.metricKey === "custom-reaction-time" &&
    row.recordIds.includes("smp_custom_reaction_time")
  ), false);
});

test("browser vault replica keeps old anchored metric points by contributing record id", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-01T12:00:00.000Z",
    metricPoints: [
      createMetricPoint({
        biomarkerKey: "biomarker:resting-heart-rate",
        contributingRecordIds: ["sample_anchor_rhr_baseline"],
        effectiveDate: "2025-01-01",
        metricKey: "resting-heart-rate",
        recordId: "summary_rhr_baseline",
        unit: "bpm",
        value: 62,
      }),
    ],
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_anchor_rhr", {
          frontmatter: {
            analysisPlan: {
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
              measurementAnchors: [{
                role: "baseline",
                kind: "wearable_summary",
                recordId: "sample_anchor_rhr_baseline",
                biomarkerKeys: ["biomarker:resting-heart-rate"],
              }],
            },
            runPlan: {
              baselineStart: "2026-05-01",
              baselineEnd: "2026-05-07",
              interventionStart: "2026-05-08",
              interventionEnd: "2026-05-14",
            },
          },
          kind: "experiment",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const row = replica.metricRows.find((entry) => entry.metricKey === "resting-heart-rate");
  assert.ok(row);
  assert.equal(row.date, "2025-01-01");
  assert.equal(row.recordIds.includes("sample_anchor_rhr_baseline"), true);
});

test("browser vault results match legacy sample-summary anchors after replica projection", async () => {
  const baselinePoint = createMetricPoint({
    biomarkerKey: "biomarker:blood-glucose",
    effectiveDate: "2025-01-01",
    metricKey: "glucose",
    recordId: "sample-summary:2025-01-01:glucose:mg_dL",
    unit: "mg/dL",
    value: 100,
  });
  const followupPoint = createMetricPoint({
    biomarkerKey: "biomarker:blood-glucose",
    effectiveDate: "2025-01-02",
    metricKey: "glucose",
    recordId: "sample-summary:2025-01-02:glucose:mg_dL",
    unit: "mg/dL",
    value: 96,
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-01T12:00:00.000Z",
    metricPoints: [
      {
        ...baselinePoint,
        source: { ...baselinePoint.source, kind: "sample-summary" },
      },
      {
        ...followupPoint,
        source: { ...followupPoint.source, kind: "sample-summary" },
      },
    ],
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_legacy_glucose", {
          frontmatter: {
            analysisPlan: {
              primaryBiomarkerKey: "biomarker:blood-glucose",
              desiredDirection: "decrease",
              measurementAnchors: [
                {
                  role: "baseline",
                  kind: "wearable_summary",
                  recordId: "sample-summary:glucose:2025-01-01",
                  biomarkerKeys: ["biomarker:blood-glucose"],
                },
                {
                  role: "followup",
                  kind: "wearable_summary",
                  recordId: "sample-summary:glucose:2025-01-02",
                  biomarkerKeys: ["biomarker:blood-glucose"],
                },
              ],
            },
            runPlan: {
              baselineStart: "2026-05-01",
              baselineEnd: "2026-05-07",
              interventionStart: "2026-05-08",
              interventionEnd: "2026-05-14",
            },
            slug: "legacy-glucose-anchor",
            status: "completed",
          },
          experimentSlug: "legacy-glucose-anchor",
          kind: "experiment",
          lookupIds: ["exp_legacy_glucose", "legacy-glucose-anchor"],
          status: "completed",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const result = selectBrowserVaultExperimentResults(
    createBrowserVaultQueryClient(replica),
    "legacy-glucose-anchor",
  );

  assert.equal(result?.biomarkers[0]?.baseline.mean, 100);
  assert.equal(result?.biomarkers[0]?.intervention.mean, 96);
  assert.equal(result?.biomarkers[0]?.deltaAbs, -4);
});

test("browser vault replica projects experiment event fields only for relevant event kinds", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "evt_session", {
          attributes: {
            afterExercise: true,
            confounders: {
              travel: true,
              trainingLoad: "heavy",
            },
            durationMinutes: 18,
            effectiveProtocolSnapshot: {
              doseSignature: "Sensitive generic snapshot should not be projected.",
            },
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            externalId: "provider-session-1",
            externalRef: {
              resourceId: "provider-session-1",
              system: "provider",
            },
            interventionType: "dry-sauna",
            markdownBody: "# Raw note",
            note: "Felt lightheaded near the end.",
            protocolId: "prot_sauna",
            provenance: {
              importedFrom: "provider",
            },
            rawProvenance: {
              payloadId: "raw-1",
            },
            regimenId: "reg_sauna",
            runPlan: {
              interventionStart: "2026-04-20",
            },
            scheduledLocalDate: "2026-04-20",
            sessionStatus: "partial",
            sessionLocalDate: "2026-04-20",
            source: "manual",
            summary: "Generic event summary should not be projected.",
            symptoms: ["lightheaded"],
            temperatureC: 88,
            timing: "evening",
          },
          body: "# Session note\n\nFelt lightheaded near the end.",
          experimentSlug: "sauna-rhr",
          kind: "intervention_session",
          links: [
            {
              targetId: "reg_sauna",
              type: "related_to",
            },
          ],
          lookupIds: ["provider-session-1", "reg_sauna"],
          primaryLookupId: "provider-session-1",
          tags: ["dry-sauna", "lightheaded"],
          title: "Dry sauna 25 minutes lightheaded",
        }),
        createEntity("event", "evt_context", {
          attributes: {
            contextType: "travel",
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            externalId: "provider-context-1",
            note: "Travel day.",
            providerRef: "provider-context-1",
            rawProvenance: {
              payloadId: "raw-2",
            },
            severity: "potential_confounder",
            summary: "Context summary should not be projected.",
          },
          body: "# Context note\n\nTravel day.",
          experimentSlug: "sauna-rhr",
          kind: "experiment_context",
          links: [
            {
              targetId: "provider-context-1",
              type: "related_to",
            },
          ],
          lookupIds: ["provider-context-1"],
          primaryLookupId: "provider-context-1",
          tags: ["travel"],
          title: "Travel day",
        }),
        createEntity("event", "evt_activity", {
          attributes: {
            afterExercise: true,
            contextType: "training",
            durationMinutes: 45,
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            externalId: "activity-1",
            interventionType: "running",
            severity: "info",
            source: "device",
            symptoms: ["sore"],
          },
          body: "# Activity note\n\nUnrelated activity details.",
          kind: "activity_session",
          tags: ["morning-run"],
          title: "Morning run",
        }),
        createEntity("journal", "journal_structured_keys", {
          attributes: {
            contextType: "travel",
            durationMinutes: 10,
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            interventionType: "dry-sauna",
            sessionStatus: "completed",
          },
          title: "Journal note with structured-looking keys",
        }),
      ],
      metadata: {
        title: "Browser vault event projection fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const session = client.entities.get("evt_session");
  const context = client.entities.get("evt_context");
  const activity = client.entities.get("evt_activity");
  const journal = client.entities.get("journal_structured_keys");

  assert.ok(session);
  assert.deepEqual(session.attributes, {
    afterExercise: true,
    confounders: {
      travel: true,
      trainingLoad: "heavy",
    },
    experimentId: "exp_sauna",
    experimentSlug: "sauna-rhr",
    interventionType: "dry-sauna",
    note: "Felt lightheaded near the end.",
    protocolId: "prot_sauna",
    scheduledLocalDate: "2026-04-20",
    sessionStatus: "partial",
    sessionLocalDate: "2026-04-20",
    source: "manual",
    symptoms: ["lightheaded"],
  });
  assert.equal(Object.hasOwn(session.attributes, "durationMinutes"), false);
  assert.equal(Object.hasOwn(session.attributes, "regimenId"), false);
  assert.equal(Object.hasOwn(session.attributes, "temperatureC"), false);
  assert.equal(Object.hasOwn(session.attributes, "timing"), false);
  assert.equal(Object.hasOwn(session.attributes, "markdownBody"), false);
  assert.equal(Object.hasOwn(session.attributes, "externalId"), false);
  assert.equal(Object.hasOwn(session.attributes, "externalRef"), false);
  assert.equal(Object.hasOwn(session.attributes, "provenance"), false);
  assert.equal(Object.hasOwn(session.attributes, "rawProvenance"), false);
  assert.equal(Object.hasOwn(session.attributes, "effectiveProtocolSnapshot"), false);
  assert.equal(Object.hasOwn(session.attributes, "runPlan"), false);
  assert.equal(Object.hasOwn(session.attributes, "summary"), false);
  assert.equal(session.bodyPreview, null);
  assert.deepEqual(session.links, []);
  assert.deepEqual(session.lookupIds, ["evt_session"]);
  assert.deepEqual(session.tags, []);
  assert.equal(session.title, null);

  assert.ok(context);
  assert.deepEqual(context.attributes, {
    contextType: "travel",
    experimentId: "exp_sauna",
    experimentSlug: "sauna-rhr",
    note: "Travel day.",
    severity: "potential_confounder",
  });
  assert.equal(Object.hasOwn(context.attributes, "externalId"), false);
  assert.equal(Object.hasOwn(context.attributes, "providerRef"), false);
  assert.equal(Object.hasOwn(context.attributes, "rawProvenance"), false);
  assert.equal(Object.hasOwn(context.attributes, "summary"), false);
  assert.equal(context.bodyPreview, null);
  assert.deepEqual(context.links, []);
  assert.deepEqual(context.lookupIds, ["evt_context"]);
  assert.deepEqual(context.tags, []);
  assert.equal(context.title, null);

  assert.ok(activity);
  assert.deepEqual(activity.attributes, { activityKind: "running", source: "device" });
  assert.equal(activity.bodyPreview, null);
  assert.deepEqual(activity.links, []);
  assert.deepEqual(activity.lookupIds, ["evt_activity"]);
  assert.deepEqual(activity.tags, []);
  assert.equal(activity.title, null);

  const timelineTitlesByEntityId = new Map(
    client.replica.timelineRows.map((row) => [row.entityId, row.title]),
  );
  assert.equal(timelineTitlesByEntityId.get("evt_session"), "Intervention session");
  assert.equal(timelineTitlesByEntityId.get("evt_context"), "Experiment context");
  assert.equal(timelineTitlesByEntityId.get("evt_activity"), "Event");

  const timelineTagsByEntityId = new Map(
    client.replica.timelineRows.map((row) => [row.entityId, row.tags]),
  );
  assert.deepEqual(timelineTagsByEntityId.get("evt_session"), []);
  assert.deepEqual(timelineTagsByEntityId.get("evt_context"), []);
  assert.deepEqual(timelineTagsByEntityId.get("evt_activity"), []);

  assert.deepEqual(client.search("sauna", { families: ["event"] }), []);
  assert.deepEqual(client.search("lightheaded", { families: ["event"] }), []);
  assert.deepEqual(client.search("travel", { families: ["event"] }), []);
  assert.deepEqual(client.search("run", { families: ["event"] }), []);

  assert.ok(journal);
  assert.deepEqual(journal.attributes, {});
});

function createExperimentOutcome(): ExperimentOutcome {
  return {
    adherenceSummary: {
      completedSessions: 4,
      minimumUsefulSessions: 3,
      status: "met_target",
      targetSessions: 4,
    },
    asOf: "2026-04-20",
    commonsProtocolRef: null,
    conclusion: {
      caveats: ["A travel day overlapped the intervention window."],
      headline: "Resting heart rate moved lower",
      plainLanguage: "The saved analysis found a lower intervention average.",
    },
    confidence: {
      level: "medium",
      reasons: ["One intervention day overlapped travel."],
    },
    confounders: ["Travel"],
    effectiveProtocolSnapshot: null,
    experiment: {
      id: "exp_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      slug: "light-morning-walk",
      status: "completed",
      title: "Morning walk",
    },
    generatedAt: "2026-04-20T12:00:00.000Z",
    metricResults: [],
    outcomeId: "outcome_exp_1",
    protocolRef: null,
    schemaVersion: "murph.experiment-outcome.v1",
    windows: {
      baselineEnd: "2026-04-07",
      baselineStart: "2026-04-01",
      interventionEnd: "2026-04-20",
      interventionStart: "2026-04-08",
    },
  };
}

function createEntity(
  family: BrowserVaultEntity["family"],
  entityId: string,
  overrides: Partial<BrowserVaultEntity> = {},
): BrowserVaultEntity {
  const title = overrides.title ?? entityId;
  const kind = overrides.kind ?? `${family}_entry`;
  const stream = overrides.stream ?? null;
  const lookupId = overrides.primaryLookupId ?? entityId;

  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date: overrides.date ?? "2026-04-20",
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family,
    frontmatter: overrides.frontmatter ?? null,
    kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [lookupId],
    occurredAt: overrides.occurredAt ?? "2026-04-20T00:00:00.000Z",
    path: overrides.path ?? `history/${family}/${entityId}.md`,
    primaryLookupId: lookupId,
    recordClass: overrides.recordClass ?? resolveRecordClass(family),
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream,
    tags: overrides.tags ?? [],
    title,
  };
}

function createMetricPoint(input: {
  biomarkerKey: string | null;
  contributingRecordIds?: readonly string[];
  effectiveDate: string;
  metricKey: string;
  recordId: string;
  unit: string;
  value: number;
}): MetricPoint {
  return {
    biomarkerKey: input.biomarkerKey,
    canonicalUnit: input.unit,
    canonicalValue: input.value,
    comparator: null,
    confidence: "medium",
    context: input.contributingRecordIds
      ? { contributingRecordIds: input.contributingRecordIds.slice() }
      : {},
    effectiveDate: input.effectiveDate,
    grain: "day",
    id: `metric-point:${input.metricKey}:${input.effectiveDate}`,
    metricKey: input.metricKey,
    observedAt: `${input.effectiveDate}T00:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Wearable summary",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: "wearable-summary",
      path: "",
      recordId: input.recordId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit,
    value: input.value,
  };
}

function resolveRecordClass(family: BrowserVaultEntity["family"]): BrowserVaultEntity["recordClass"] {
  switch (family) {
    case "event":
      return "ledger";
    case "experiment":
    case "habitat":
      return "bank";
    case "journal":
      return "ledger";
    case "sample":
      return "sample";
    default:
      throw new Error(`Unsupported browser-vault test family: ${family}`);
  }
}

function requireStringAttribute(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
}

function requireStringRecord(value: unknown, label: string): Record<string, string> {
  const record = requireRecord(value, label);
  const output: Record<string, string> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      throw new TypeError(`${label}.${key} must be a string`);
    }
    output[key] = entry;
  }

  return output;
}

function requireHabitatIndicators(value: unknown): Record<string, HabitatIndicatorValue> {
  const record = requireRecord(value, "habitat indicators");
  const output: Record<string, HabitatIndicatorValue> = {};

  for (const [key, entry] of Object.entries(record)) {
    const isHabitatIndicatorValue =
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry));
    if (!isHabitatIndicatorValue) {
      throw new TypeError(`habitat indicators.${key} must be a habitat indicator value`);
    }
    output[key] = entry;
  }

  return output;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
