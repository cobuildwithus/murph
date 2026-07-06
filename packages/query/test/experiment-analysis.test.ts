import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  analyzeExperimentOutcome,
  buildExperimentProgressCard,
  decideExperimentFollowupDue,
  summarizeExperimentProgress,
  type MetricPoint,
} from "../src/index.ts";
import {
  buildExperimentProgressCardPath,
  decodeExperimentProgressCard,
  EXPERIMENT_PROGRESS_CARD_MAX_WEEKS,
} from "@murphai/contracts";

function makeEntity(
  overrides: Partial<CanonicalEntity> & Pick<CanonicalEntity, "entityId" | "family" | "kind" | "recordClass">,
): CanonicalEntity {
  return {
    entityId: overrides.entityId,
    primaryLookupId: overrides.primaryLookupId ?? overrides.entityId,
    lookupIds: overrides.lookupIds ?? [overrides.entityId],
    family: overrides.family,
    recordClass: overrides.recordClass,
    kind: overrides.kind,
    status: overrides.status ?? null,
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    path: overrides.path ?? `history/${overrides.family}/${overrides.entityId}.md`,
    title: overrides.title ?? null,
    body: overrides.body ?? null,
    attributes: overrides.attributes ?? {},
    frontmatter: overrides.frontmatter ?? null,
    links: overrides.links ?? [],
    relatedIds: overrides.relatedIds ?? [],
    stream: overrides.stream ?? null,
    experimentSlug: overrides.experimentSlug ?? null,
    tags: overrides.tags ?? [],
  };
}

type TestExperimentStatus = "active" | "completed" | "planned" | "paused" | "abandoned";

function makeExperiment(
  status: TestExperimentStatus = "active",
  overrides: {
    analysisPlan?: Record<string, unknown>;
    assistantSupport?: Record<string, unknown>;
    commonsProtocolRef?: Record<string, unknown> | null;
    effectiveProtocolSnapshot?: Record<string, unknown> | null;
    experimentId?: string;
    protocolRef?: Record<string, unknown> | null;
    runPlan?: Record<string, unknown>;
    slug?: string;
    startedOn?: string;
  } = {},
): CanonicalEntity {
  const experimentId = overrides.experimentId ?? "exp_01JNV4458HYPP53JDQCBP1QJFM";
  const slug = overrides.slug ?? "sauna-rhr";
  const startedOn = overrides.startedOn ?? "2026-04-01";
  const runPlan = overrides.runPlan ?? {
    baselineStart: "2026-04-01",
    baselineEnd: "2026-04-07",
    interventionStart: "2026-04-08",
    interventionEnd: "2026-04-21",
    modality: "sauna",
    targetSessions: 6,
    minimumUsefulSessions: 4,
  };
  const analysisPlan = overrides.analysisPlan ?? {
    primaryBiomarkerKey: "biomarker:resting-heart-rate",
    desiredDirection: "decrease",
  };
  const assistantSupport = overrides.assistantSupport ?? {
    remindersEnabled: true,
    weeklyDigestEnabled: false,
  };
  const commonsProtocolRef =
    overrides.commonsProtocolRef === null
      ? undefined
      : overrides.commonsProtocolRef ?? {
          key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
          pageRevisionId: "sha256:page-revision",
          runSpecRevisionId: "sha256:run-spec-revision",
          testPlanId: "rhr-21d",
        };
  const protocolRef =
    overrides.protocolRef === null ? undefined : overrides.protocolRef;
  const effectiveProtocolSnapshot =
    overrides.effectiveProtocolSnapshot === null
      ? undefined
      : overrides.effectiveProtocolSnapshot ??
        (commonsProtocolRef
          ? {
              effectiveSpecHash: `sha256:${"4".repeat(64)}`,
              doseSignature: "3x/week dry sauna, 15-20 min, 80-100 C",
              modality: "traditional_dry_sauna",
              frequency: {
                sessionsPerWeek: 3,
              },
              durationMinutes: {
                min: 15,
                max: 20,
              },
              temperatureC: {
                min: 80,
                max: 100,
              },
              targetSessions: 6,
              minimumUsefulSessions: 4,
            }
          : undefined);

  return makeEntity({
    entityId: experimentId,
    family: "experiment",
    kind: "experiment_entry",
    recordClass: "bank",
    occurredAt: `${startedOn}T08:00:00.000Z`,
    date: startedOn,
    experimentSlug: slug,
    status,
    title: slug === "sauna-rhr" ? "Sauna RHR" : "Sleep metrics",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId,
      slug,
      status,
      title: slug === "sauna-rhr" ? "Sauna RHR" : "Sleep metrics",
      startedOn,
      ...(commonsProtocolRef ? { commonsProtocolRef } : {}),
      ...(protocolRef ? { protocolRef } : {}),
      ...(effectiveProtocolSnapshot ? { effectiveProtocolSnapshot } : {}),
      runPlan,
      analysisPlan,
      assistantSupport,
    },
  });
}

function makeObservation(input: {
  entityId: string;
  dayKey: string;
  metric: string;
  occurredAt: string;
  provider?: string;
  unit: string;
  value: number;
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "event",
    kind: "observation",
    recordClass: "ledger",
    occurredAt: input.occurredAt,
    date: input.dayKey,
    title: `${input.provider ?? "whoop"} ${input.metric}`,
    attributes: {
      dayKey: input.dayKey,
      externalRef: {
        resourceId: `${input.entityId}-resource`,
        resourceType: "summary",
        system: input.provider ?? "whoop",
      },
      metric: input.metric,
      recordedAt: input.occurredAt,
      unit: input.unit,
      value: input.value,
    },
  });
}

function makeLabResult(input: {
  biomarkerSlug: string;
  collectedAt: string;
  entityId: string;
  unit: string;
  value: number;
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "event",
    kind: "test",
    recordClass: "ledger",
    occurredAt: input.collectedAt,
    date: input.collectedAt.slice(0, 10),
    title: "Lab result",
    attributes: {
      collectedAt: input.collectedAt,
      results: [{
        analyte: input.biomarkerSlug,
        biomarkerSlug: input.biomarkerSlug,
        unit: input.unit,
        value: input.value,
      }],
      source: "manual",
    },
  });
}

function makeSample(input: {
  entityId: string;
  dayKey: string;
  occurredAt: string;
  provider?: string;
  stream: string;
  unit: string;
  value: number;
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "sample",
    kind: "sample",
    recordClass: "ledger",
    occurredAt: input.occurredAt,
    date: input.dayKey,
    stream: input.stream,
    title: `${input.provider ?? "oura"} ${input.stream}`,
    attributes: {
      dayKey: input.dayKey,
      externalRef: {
        resourceId: `${input.entityId}-resource`,
        resourceType: "summary",
        system: input.provider ?? "oura",
      },
      recordedAt: input.occurredAt,
      unit: input.unit,
      value: input.value,
    },
  });
}

function makeMetricSample(input: {
  entityId: string;
  dayKey: string;
  metric: string;
  occurredAt: string;
  quality?: string;
  source?: string;
  unit: string;
  value: number;
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "sample",
    kind: "metric_sample",
    recordClass: "sample",
    occurredAt: input.occurredAt,
    date: input.dayKey,
    stream: input.metric,
    title: `Metric sample ${input.metric}`,
    attributes: {
      dayKey: input.dayKey,
      metric: input.metric,
      quality: input.quality ?? "derived",
      recordedAt: input.occurredAt,
      source: input.source ?? "derived",
      unit: input.unit,
      value: input.value,
    },
  });
}

function makeProjectedGlucosePoint(input: {
  contributingRecordIds: string[];
  date: string;
  sourceRecordId: string;
  value: number;
}): MetricPoint {
  return makeProjectedMetricPoint({
    biomarkerKey: "biomarker:blood-glucose",
    contributingRecordIds: input.contributingRecordIds,
    date: input.date,
    metricKey: "glucose",
    sourceKind: "wearable-summary",
    sourceLabel: "Wearable summary",
    sourceRecordId: input.sourceRecordId,
    unit: "mg/dL",
    value: input.value,
  });
}

function makeProjectedMetricPoint(input: {
  biomarkerKey: string;
  canonicalUnit?: string | null;
  canonicalValue?: number | null;
  contributingRecordIds?: string[];
  date: string;
  metricKey: string;
  sourceKind: MetricPoint["source"]["kind"];
  sourceLabel: string;
  sourceRecordId: string;
  unit: string;
  value: number;
}): MetricPoint {
  return {
    schemaVersion: "murph.metric-point.v1",
    biomarkerKey: input.biomarkerKey,
    canonicalUnit: input.canonicalUnit === undefined ? input.unit : input.canonicalUnit,
    canonicalValue: input.canonicalValue === undefined ? input.value : input.canonicalValue,
    comparator: null,
    confidence: "medium",
    context: {
      contributingRecordIds: input.contributingRecordIds ?? [input.sourceRecordId],
      syntheticRecordId: input.sourceRecordId,
    },
    effectiveDate: input.date,
    grain: "day",
    id: `metric-point:${input.sourceRecordId}`,
    metricKey: input.metricKey,
    observedAt: `${input.date}T12:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: "whoop",
      rawRefs: [],
      sourceLabel: input.sourceLabel,
    },
    recordedAt: `${input.date}T12:00:00.000Z`,
    reportedAt: null,
    source: {
      family: "derived",
      kind: input.sourceKind,
      path: `derived/${input.sourceKind}`,
      recordId: input.sourceRecordId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit,
    value: input.value,
  };
}

function makeSession(input: {
  entityId: string;
  occurredAt: string;
  afterExercise?: boolean;
  confounders?: string[];
  experimentId?: string;
  experimentSlug?: string;
  relatedIds?: string[];
  sessionStatus?: string;
  symptoms?: string[];
}): CanonicalEntity {
  const dayKey = input.occurredAt.slice(0, 10);
  const experimentSlug = input.experimentSlug ?? "sauna-rhr";

  return makeEntity({
    entityId: input.entityId,
    family: "event",
    kind: "intervention_session",
    recordClass: "ledger",
    occurredAt: input.occurredAt,
    date: dayKey,
    experimentSlug,
    title: "Sauna session",
    relatedIds: input.relatedIds,
    attributes: {
      afterExercise: input.afterExercise,
      confounders: input.confounders,
      experimentId: input.experimentId,
      experimentSlug,
      sessionStatus: input.sessionStatus,
      symptoms: input.symptoms,
    },
  });
}

function makeActivitySession(input: {
  activityType: string;
  dayKey: string;
  entityId: string;
  occurredAt?: string;
  sportName?: string;
  title?: string;
}): CanonicalEntity {
  return makeEntity({
    entityId: input.entityId,
    family: "event",
    kind: "activity_session",
    recordClass: "ledger",
    occurredAt: input.occurredAt ?? `${input.dayKey}T12:00:00.000Z`,
    date: input.dayKey,
    title: input.title ?? input.activityType,
    attributes: {
      activityType: input.activityType,
      sportName: input.sportName ?? input.activityType,
    },
  });
}

function makeContextNote(): CanonicalEntity {
  return makeEntity({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YK",
    family: "event",
    kind: "experiment_context",
    recordClass: "ledger",
    occurredAt: "2026-04-19T09:00:00.000Z",
    date: "2026-04-19",
    experimentSlug: "sauna-rhr",
    title: "Travel day",
    attributes: {
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
      experimentSlug: "sauna-rhr",
      contextType: "travel",
      severity: "potential_confounder",
      note: "Hotel sleep and travel day during the intervention window.",
    },
  });
}

function makeSafetyContext(): CanonicalEntity {
  return makeEntity({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YL",
    family: "event",
    kind: "experiment_context",
    recordClass: "ledger",
    occurredAt: "2026-04-20T08:30:00.000Z",
    date: "2026-04-20",
    experimentSlug: "sauna-rhr",
    title: "Dizziness follow-up",
    attributes: {
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
      experimentSlug: "sauna-rhr",
      contextType: "dizziness",
      severity: "safety",
      note: "The user felt dizzy after the session and asked whether to continue.",
    },
  });
}

function createExperimentVault() {
  return createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis",
    metadata: null,
    entities: [
      makeExperiment(),
      makeObservation({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YA",
        dayKey: "2026-04-01",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-01T06:00:00.000Z",
        unit: "bpm",
        value: 62,
      }),
      makeObservation({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YB",
        dayKey: "2026-04-02",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-02T06:00:00.000Z",
        unit: "bpm",
        value: 61,
      }),
      makeObservation({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YC",
        dayKey: "2026-04-03",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-03T06:00:00.000Z",
        unit: "bpm",
        value: 61,
      }),
      makeObservation({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YD",
        dayKey: "2026-04-08",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-08T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
      makeObservation({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YE",
        dayKey: "2026-04-09",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-09T06:00:00.000Z",
        unit: "bpm",
        value: 58,
      }),
      makeObservation({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YF",
        dayKey: "2026-04-10",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-10T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YG",
        occurredAt: "2026-04-08T19:00:00.000Z",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YH",
        occurredAt: "2026-04-12T19:30:00.000Z",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YJ",
        occurredAt: "2026-04-18T20:00:00.000Z",
        afterExercise: true,
        confounders: ["hard-training"],
        symptoms: ["lightheaded"],
      }),
      makeContextNote(),
    ],
  });
}

function createExperimentVaultWithSafetyFollowUp() {
  return createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-safety",
    metadata: null,
    entities: [...createExperimentVault().entities, makeSafetyContext()],
  });
}

test("experiment progress summarizes adherence, coverage, confounders, and reminder recommendations", () => {
  const progress = summarizeExperimentProgress(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-20",
  });

  assert.equal(progress.schema, "murph.experiment-progress.v2");
  assert.equal(progress.schemaVersion, "murph.experiment-progress.v2");
  assert.equal(progress.phase, "intervention");
  assert.equal(progress.dayInRun, 20);
  assert.equal(progress.experiment.id, "exp_01JNV4458HYPP53JDQCBP1QJFM");
  assert.equal(progress.commonsProtocolRef?.key, "protocol_variant:dry-sauna/murph-finnish-standard-3x-week");
  assert.deepEqual(progress.windows, {
    baselineEnd: "2026-04-07",
    baselineStart: "2026-04-01",
    interventionEnd: "2026-04-21",
    interventionStart: "2026-04-08",
  });

  assert.deepEqual(progress.adherence, {
    completedSessions: 3,
    expectedSessionsByNow: 5,
    minimumUsefulSessions: 4,
    sessionEventIds: [
      "evt_01JNV45RHN0TQ9ZXE0A7YSE1YG",
      "evt_01JNV45RHN0TQ9ZXE0A7YSE1YH",
      "evt_01JNV45RHN0TQ9ZXE0A7YSE1YJ",
    ],
    status: "behind",
    targetSessions: 6,
  });
  assert.deepEqual(progress.dataCoverage, {
    baselineDaysAvailable: 3,
    interventionDaysAvailable: 3,
    primaryBiomarkerKey: "biomarker:resting-heart-rate",
    primaryMetricDaysAvailable: 6,
    status: "sufficient_for_progress",
    wearableProviders: ["whoop"],
  });
  assert.deepEqual(progress.signals[0], {
    baselineDayCount: 3,
    baselineMean: 61.33,
    biomarkerKey: "biomarker:resting-heart-rate",
    completeness: "good",
    deltaAbs: -2.66,
    deltaPct: -4.34,
    expectedDirection: "decrease",
    interventionDayCount: 3,
    interventionMean: 58.67,
    intervention: {
      daysWithData: 3,
      mean: 58.67,
      totalDays: 13,
      unit: "bpm",
    },
    label: "Resting Heart Rate",
    movedAsExpected: true,
    unit: "bpm",
    baseline: {
      daysWithData: 3,
      mean: 61.33,
      totalDays: 7,
      unit: "bpm",
    },
  });
  assert.deepEqual(progress.earlySignals?.[0], {
    baselineDaysAvailable: 3,
    baselineMean: 61.33,
    biomarkerKey: "biomarker:resting-heart-rate",
    confidence: "low",
    currentInterventionMean: 58.67,
    deltaAbs: -2.66,
    expectedDirection: "decrease",
    interventionDaysAvailable: 3,
    label: "Resting Heart Rate",
    movedAsExpected: true,
    reason: "Only 3 intervention day(s) are available so far.",
    unit: "bpm",
  });
  assert.deepEqual(progress.confounders, [
    "post-exercise session on 2026-04-18",
    "hard training on 2026-04-18",
    "lightheaded reported on 2026-04-18",
    "travel context logged on 2026-04-19",
  ]);
  assert.deepEqual(progress.recommendation, {
    action: "remind",
    reason: "Logged sessions are behind the current target pace.",
    shouldNotifyUser: true,
  });
});

test("experiment progress counts calendar-less running adherence from activity sessions by sport", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-running-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFN",
        slug: "run-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Run",
          targetSessions: 24,
          minimumUsefulSessions: 12,
        },
      }),
      makeActivitySession({ entityId: "evt_run_1", dayKey: "2026-06-01", activityType: "Running" }),
      makeActivitySession({ entityId: "evt_run_2", dayKey: "2026-06-03", activityType: "Run" }),
      makeActivitySession({ entityId: "evt_run_3", dayKey: "2026-06-05", activityType: "Morning run" }),
      makeActivitySession({ entityId: "evt_run_4", dayKey: "2026-06-08", activityType: "Trail running" }),
      makeActivitySession({ entityId: "evt_bike_1", dayKey: "2026-06-02", activityType: "Cycling" }),
      makeActivitySession({ entityId: "evt_walk_1", dayKey: "2026-06-04", activityType: "Walking" }),
      makeActivitySession({ entityId: "evt_strength_1", dayKey: "2026-06-06", activityType: "Strength" }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "run-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 4);
  assert.equal(progress.adherence.expectedSessionsByNow, 7);
  assert.equal(progress.adherence.status, "behind");
  assert.equal(progress.adherence.targetSessions, 24);
});

test("experiment analysis uses lab measurement anchors separately from run baseline windows", () => {
  const experiment = makeExperiment("completed", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFK",
    slug: "psyllium-ldl",
    startedOn: "2026-05-09",
    runPlan: {
      baselineStart: "2026-05-02",
      baselineEnd: "2026-05-08",
      interventionStart: "2026-05-09",
      interventionEnd: "2026-08-01",
      modality: "psyllium",
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:ldl-c",
      desiredDirection: "decrease",
      measurementAnchors: [
        {
          role: "baseline",
          kind: "lab_panel",
          recordId: "evt_lipid_baseline",
          biomarkerKeys: ["biomarker:ldl-c"],
          observedOn: "2026-04-23",
        },
        {
          role: "followup",
          kind: "lab_panel",
          recordId: "evt_lipid_followup",
          biomarkerKeys: ["biomarker:ldl-c"],
          observedOn: "2026-08-02",
        },
      ],
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-lab-anchors",
    metadata: null,
    entities: [
      experiment,
      makeLabResult({
        biomarkerSlug: "ldl-c",
        collectedAt: "2026-04-23T08:00:00.000Z",
        entityId: "evt_lipid_baseline",
        unit: "mg/dL",
        value: 140,
      }),
      makeLabResult({
        biomarkerSlug: "ldl-c",
        collectedAt: "2026-08-02T08:00:00.000Z",
        entityId: "evt_lipid_followup",
        unit: "mg/dL",
        value: 120,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "psyllium-ldl", {
    asOf: "2026-08-02",
  });
  assert.equal(progress.analysisReadiness.status, "ready");
  assert.deepEqual(progress.windows, {
    baselineEnd: "2026-05-08",
    baselineStart: "2026-05-02",
    interventionEnd: "2026-08-01",
    interventionStart: "2026-05-09",
  });
  assert.deepEqual(progress.dataCoverage, {
    baselineDaysAvailable: 1,
    interventionDaysAvailable: 1,
    primaryBiomarkerKey: "biomarker:ldl-c",
    primaryMetricDaysAvailable: 2,
    status: "ready_for_review",
    wearableProviders: [],
  });
  assert.deepEqual(progress.signals[0], {
    baselineDayCount: 1,
    baselineMean: 140,
    baseline: {
      daysWithData: 1,
      mean: 140,
      totalDays: 1,
      unit: "mg/dL",
    },
    biomarkerKey: "biomarker:ldl-c",
    completeness: "good",
    deltaAbs: -20,
    deltaPct: -14.29,
    expectedDirection: "decrease",
    interventionDayCount: 1,
    interventionMean: 120,
    intervention: {
      daysWithData: 1,
      mean: 120,
      totalDays: 1,
      unit: "mg/dL",
    },
    label: "Ldl C",
    movedAsExpected: true,
    unit: "mg/dL",
  });

  const outcome = analyzeExperimentOutcome(vault, "psyllium-ldl", {
    asOf: "2026-08-02",
  });
  assert.equal(outcome.metricResults[0]?.baselineMean, 140);
  assert.equal(outcome.metricResults[0]?.interventionMean, 120);
  assert.equal(outcome.metricResults[0]?.deltaAbs, -20);

  const historicalProgress = summarizeExperimentProgress(vault, "psyllium-ldl", {
    asOf: "2026-06-01",
  });
  assert.equal(historicalProgress.signals[0]?.baselineMean, 140);
  assert.equal(historicalProgress.signals[0]?.interventionMean, null);
  assert.equal(historicalProgress.signals[0]?.deltaAbs, null);

  const historicalOutcome = analyzeExperimentOutcome(vault, "psyllium-ldl", {
    asOf: "2026-06-01",
  });
  assert.equal(historicalOutcome.metricResults[0]?.baselineMean, 140);
  assert.equal(historicalOutcome.metricResults[0]?.interventionMean, null);
  assert.equal(historicalOutcome.metricResults[0]?.deltaAbs, null);
});

test("experiment analysis matches anchors against contributing metric records", () => {
  const experiment = makeExperiment("completed", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGP",
    slug: "glucose-summary-anchors",
    runPlan: {
      baselineStart: "2026-06-01",
      baselineEnd: "2026-06-01",
      interventionStart: "2026-06-02",
      interventionEnd: "2026-06-02",
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:blood-glucose",
      desiredDirection: "decrease",
      measurementAnchors: [
        {
          role: "baseline",
          kind: "wearable_summary",
          recordId: "sample_glucose_baseline_selected",
          biomarkerKeys: ["biomarker:blood-glucose"],
          observedOn: "2026-06-01",
        },
        {
          role: "followup",
          kind: "wearable_summary",
          recordId: "sample_glucose_followup_selected",
          biomarkerKeys: ["biomarker:blood-glucose"],
          observedOn: "2026-06-02",
        },
      ],
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-contributing-anchors",
    metadata: null,
    entities: [experiment],
  });
  const metricPoints: MetricPoint[] = [
    makeProjectedGlucosePoint({
      date: "2026-06-01",
      sourceRecordId: "wearable-summary:blood-glucose:2026-06-01",
      contributingRecordIds: [
        "sample_glucose_baseline_other",
        "sample_glucose_baseline_selected",
      ],
      value: 100,
    }),
    makeProjectedGlucosePoint({
      date: "2026-06-02",
      sourceRecordId: "wearable-summary:blood-glucose:2026-06-02",
      contributingRecordIds: [
        "sample_glucose_followup_other",
        "sample_glucose_followup_selected",
      ],
      value: 96,
    }),
  ];

  const outcome = analyzeExperimentOutcome(vault, "glucose-summary-anchors", {
    asOf: "2026-06-02",
    metricPoints,
  });

  assert.equal(outcome.metricResults[0]?.baselineMean, 100);
  assert.equal(outcome.metricResults[0]?.interventionMean, 96);
  assert.equal(outcome.metricResults[0]?.deltaAbs, -4);
});

test("experiment analysis skips uncanonicalized anchored metric fallback values", () => {
  const experiment = makeExperiment("completed", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGW",
    slug: "glucose-uncanonicalized-anchors",
    runPlan: {
      baselineStart: "2026-06-01",
      baselineEnd: "2026-06-01",
      interventionStart: "2026-06-02",
      interventionEnd: "2026-06-02",
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:blood-glucose",
      desiredDirection: "decrease",
      measurementAnchors: [
        {
          role: "baseline",
          kind: "wearable_summary",
          recordId: "sample_glucose_canonical_baseline",
          biomarkerKeys: ["biomarker:blood-glucose"],
          observedOn: "2026-06-01",
        },
        {
          role: "followup",
          kind: "wearable_summary",
          recordId: "sample_glucose_raw_followup",
          biomarkerKeys: ["biomarker:blood-glucose"],
          observedOn: "2026-06-02",
        },
      ],
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-uncanonicalized-anchors",
    metadata: null,
    entities: [experiment],
  });

  const outcome = analyzeExperimentOutcome(vault, "glucose-uncanonicalized-anchors", {
    asOf: "2026-06-02",
    metricPoints: [
      makeProjectedMetricPoint({
        biomarkerKey: "biomarker:blood-glucose",
        contributingRecordIds: ["sample_glucose_canonical_baseline"],
        date: "2026-06-01",
        metricKey: "glucose",
        sourceKind: "wearable-summary",
        sourceLabel: "Wearable summary",
        sourceRecordId: "summary_glucose_canonical_baseline",
        unit: "mg/dL",
        value: 100,
      }),
      makeProjectedMetricPoint({
        biomarkerKey: "biomarker:blood-glucose",
        canonicalUnit: null,
        canonicalValue: null,
        contributingRecordIds: ["sample_glucose_raw_followup"],
        date: "2026-06-02",
        metricKey: "glucose",
        sourceKind: "wearable-summary",
        sourceLabel: "Wearable summary",
        sourceRecordId: "summary_glucose_raw_followup",
        unit: "g/L",
        value: 0.9,
      }),
    ],
  });

  assert.equal(outcome.metricResults[0]?.baselineMean, 100);
  assert.equal(outcome.metricResults[0]?.interventionMean, null);
  assert.equal(outcome.metricResults[0]?.deltaAbs, null);
});

test("metric adherence uses the selected same-day metric point", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGS",
    slug: "hrv-adherence-selection",
    runPlan: {
      baselineStart: "2026-06-01",
      baselineEnd: "2026-06-01",
      interventionStart: "2026-06-02",
      interventionEnd: "2026-06-02",
      adherenceTargets: [
        {
          targetId: "hrv-threshold",
          label: "HRV threshold",
          phase: "intervention",
          calendar: {
            kind: "daily",
            timeZone: "UTC",
          },
          evidence: {
            kind: "metricThreshold",
            metricKey: "hrv-rmssd",
            op: ">=",
            value: 50,
            missing: "unknown",
          },
          rollup: {
            targetCompletions: 1,
            minimumUsefulCompletions: 1,
          },
        },
      ],
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:hrv-rmssd",
      desiredDirection: "increase",
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-adherence-selected-metric",
    metadata: null,
    entities: [experiment],
  });
  const metricPoints: MetricPoint[] = [
    makeProjectedMetricPoint({
      biomarkerKey: "biomarker:hrv-rmssd",
      date: "2026-06-02",
      metricKey: "hrv-rmssd",
      sourceKind: "wearable-summary",
      sourceLabel: "Recovery summary",
      sourceRecordId: "recovery_hrv_2026_06_02",
      unit: "ms",
      value: 40,
    }),
    makeProjectedMetricPoint({
      biomarkerKey: "biomarker:hrv-rmssd",
      date: "2026-06-02",
      metricKey: "hrv-rmssd",
      sourceKind: "sleep-summary",
      sourceLabel: "Sleep summary",
      sourceRecordId: "sleep_hrv_2026_06_02",
      unit: "ms",
      value: 55,
    }),
  ];

  const progress = summarizeExperimentProgress(vault, "hrv-adherence-selection", {
    asOf: "2026-06-02",
    metricPoints,
  });

  assert.equal(progress.adherence.completedSessions, 0);
  assert.equal(progress.adherence.expectedSessionsByNow, 1);
  assert.equal(progress.adherence.status, "not_started");
});

test("metric adherence exact-matches metrics that share a biomarker", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGD",
    slug: "lowest-spo2-adherence",
    runPlan: {
      baselineStart: "2026-06-01",
      baselineEnd: "2026-06-01",
      interventionStart: "2026-06-02",
      interventionEnd: "2026-06-02",
      adherenceTargets: [
        {
          targetId: "lowest-spo2-threshold",
          label: "Lowest SpO2 threshold",
          phase: "intervention",
          calendar: {
            kind: "daily",
            timeZone: "UTC",
          },
          evidence: {
            kind: "metricThreshold",
            metricKey: "lowest-spo2",
            op: ">=",
            value: 90,
            missing: "unknown",
          },
          rollup: {
            targetCompletions: 1,
            minimumUsefulCompletions: 1,
          },
        },
      ],
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:blood-oxygen-spo2",
      desiredDirection: "increase",
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-adherence-exact-metric",
    metadata: null,
    entities: [experiment],
  });
  const metricPoints: MetricPoint[] = [
    makeProjectedMetricPoint({
      biomarkerKey: "biomarker:blood-oxygen-spo2",
      date: "2026-06-02",
      metricKey: "spo2",
      sourceKind: "wearable-summary",
      sourceLabel: "Oxygen summary",
      sourceRecordId: "spo2_2026_06_02",
      unit: "%",
      value: 96,
    }),
    makeProjectedMetricPoint({
      biomarkerKey: "biomarker:blood-oxygen-spo2",
      date: "2026-06-02",
      metricKey: "lowest-spo2",
      sourceKind: "sleep-summary",
      sourceLabel: "Sleep oxygen summary",
      sourceRecordId: "lowest_spo2_2026_06_02",
      unit: "%",
      value: 85,
    }),
  ];

  const progress = summarizeExperimentProgress(vault, "lowest-spo2-adherence", {
    asOf: "2026-06-02",
    metricPoints,
  });

  assert.equal(progress.adherence.completedSessions, 0);
  assert.equal(progress.adherence.expectedSessionsByNow, 1);
  assert.equal(progress.adherence.status, "not_started");
});

test("incomplete point measurement plans do not mix lab anchors with run windows", () => {
  const experiment = makeExperiment("completed", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFK",
    slug: "rhr-baseline-anchor-only",
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:resting-heart-rate",
      desiredDirection: "decrease",
      measurementAnchors: [
        {
          role: "baseline",
          kind: "lab_panel",
          recordId: "evt_rhr_lab_baseline",
          biomarkerKeys: ["biomarker:resting-heart-rate"],
          observedOn: "2026-03-25",
        },
      ],
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-no-mixed-windows",
    metadata: null,
    entities: [
      experiment,
      makeLabResult({
        biomarkerSlug: "resting-heart-rate",
        collectedAt: "2026-03-25T08:00:00.000Z",
        entityId: "evt_rhr_lab_baseline",
        unit: "bpm",
        value: 70,
      }),
      makeObservation({
        entityId: "evt_rhr_daily_baseline_1",
        dayKey: "2026-04-01",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-01T06:00:00.000Z",
        unit: "bpm",
        value: 62,
      }),
      makeObservation({
        entityId: "evt_rhr_daily_baseline_2",
        dayKey: "2026-04-02",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-02T06:00:00.000Z",
        unit: "bpm",
        value: 61,
      }),
      makeObservation({
        entityId: "evt_rhr_daily_baseline_3",
        dayKey: "2026-04-03",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-03T06:00:00.000Z",
        unit: "bpm",
        value: 60,
      }),
      makeObservation({
        entityId: "evt_rhr_daily_intervention_1",
        dayKey: "2026-04-08",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-08T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
      makeObservation({
        entityId: "evt_rhr_daily_intervention_2",
        dayKey: "2026-04-09",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-09T06:00:00.000Z",
        unit: "bpm",
        value: 58,
      }),
      makeObservation({
        entityId: "evt_rhr_daily_intervention_3",
        dayKey: "2026-04-10",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-10T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "rhr-baseline-anchor-only", {
    asOf: "2026-04-25",
  });

  assert.equal(progress.analysisReadiness.status, "ready");
  assert.equal(progress.dataCoverage.status, "ready_for_review");
  assert.equal(progress.signals[0]?.baselineDayCount, 3);
  assert.equal(progress.signals[0]?.baselineMean, 61);
  assert.equal(progress.signals[0]?.interventionDayCount, 3);
  assert.equal(progress.signals[0]?.interventionMean, 58.67);
});

test("lab-backed experiments do not require a run baseline window", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFK",
    slug: "psyllium-no-run-in",
    startedOn: "2026-05-09",
    runPlan: {
      interventionStart: "2026-05-09",
      interventionEnd: "2026-08-01",
      modality: "psyllium",
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:ldl-c",
      desiredDirection: "decrease",
      measurementAnchors: [
        {
          role: "baseline",
          kind: "lab_panel",
          recordId: "evt_lipid_baseline",
          biomarkerKeys: ["biomarker:ldl-c"],
          observedOn: "2026-04-23",
        },
      ],
      plannedMeasurements: [
        {
          role: "followup",
          kind: "lab_panel",
          biomarkerKeys: ["biomarker:ldl-c"],
          targetWindow: {
            start: "2026-07-26",
            end: "2026-08-08",
          },
        },
      ],
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-lab-no-run-in",
    metadata: null,
    entities: [
      experiment,
      makeLabResult({
        biomarkerSlug: "ldl-c",
        collectedAt: "2026-04-23T08:00:00.000Z",
        entityId: "evt_lipid_baseline",
        unit: "mg/dL",
        value: 140,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "psyllium-no-run-in", {
    asOf: "2026-05-10",
  });

  assert.deepEqual(progress.setupReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.deepEqual(progress.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.equal(progress.phase, "intervention");
  assert.equal(progress.dayInRun, 2);
  assert.deepEqual(progress.windows, {
    baselineEnd: null,
    baselineStart: null,
    interventionEnd: "2026-08-01",
    interventionStart: "2026-05-09",
  });
});

test("one-sided lab measurement plans still need a run baseline window", () => {
  const cases = [
    {
      slug: "psyllium-baseline-only",
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:ldl-c",
        desiredDirection: "decrease",
        measurementAnchors: [
          {
            role: "baseline",
            kind: "lab_panel",
            recordId: "evt_baseline_only",
            biomarkerKeys: ["biomarker:ldl-c"],
            observedOn: "2026-04-23",
          },
        ],
      },
    },
    {
      slug: "psyllium-followup-only",
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFK",
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:ldl-c",
        desiredDirection: "decrease",
        plannedMeasurements: [
          {
            role: "followup",
            kind: "lab_panel",
            biomarkerKeys: ["biomarker:ldl-c"],
            targetWindow: {
              start: "2026-07-26",
              end: "2026-08-08",
            },
          },
        ],
      },
    },
  ];

  for (const testCase of cases) {
    const vault = createVaultReadModel({
      vaultRoot: `/virtual/experiment-analysis-${testCase.slug}`,
      metadata: null,
      entities: [
        makeExperiment("active", {
          experimentId: testCase.experimentId,
          slug: testCase.slug,
          startedOn: "2026-05-09",
          runPlan: {
            interventionStart: "2026-05-09",
            interventionEnd: "2026-08-01",
            modality: "psyllium",
          },
          analysisPlan: testCase.analysisPlan,
        }),
      ],
    });

    const progress = summarizeExperimentProgress(vault, testCase.slug, {
      asOf: "2026-05-10",
    });

    assert.deepEqual(progress.setupReadiness, {
      status: "incomplete",
      blockingReasons: ["missing_baseline_window"],
    });
    assert.deepEqual(progress.analysisReadiness, {
      status: "incomplete",
      blockingReasons: ["missing_metric_window"],
    });
  }
});

test("experiment progress treats incomplete setup as setup-missing rather than missing wearable data", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFS",
    slug: "partial-setup",
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-07",
      interventionStart: "2026-04-08",
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:resting-heart-rate",
      desiredDirection: "decrease",
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-partial-setup",
    metadata: null,
    entities: [experiment],
  });

  const progress = summarizeExperimentProgress(vault, "partial-setup", {
    asOf: "2026-04-10",
  });

  assert.equal(progress.phase, "planned");
  assert.equal(progress.dayInRun, null);
  assert.equal(progress.dataCoverage.status, "insufficient");
  assert.deepEqual(progress.setupReadiness, {
    status: "incomplete",
    blockingReasons: ["missing_intervention_window"],
  });
  assert.deepEqual(progress.analysisReadiness, {
    status: "incomplete",
    blockingReasons: ["missing_metric_window"],
  });
  assert.equal(progress.recommendation.reason, "Too early; no action is needed.");
});

test("experiment analysis rejects unbounded run-plan date windows before expanding days", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-wide-window",
    metadata: null,
    entities: [
      makeExperiment("active", {
        slug: "wide-window",
        runPlan: {
          baselineStart: "2020-01-01",
          baselineEnd: "2026-01-01",
          interventionStart: "2026-01-02",
          interventionEnd: "2026-01-09",
          modality: "sauna",
          targetSessions: 3,
          minimumUsefulSessions: 2,
        },
      }),
    ],
  });

  assert.throws(
    () => summarizeExperimentProgress(vault, "wide-window", { asOf: "2026-01-03" }),
    /maximum supported span is 366 days/u,
  );
});

test("experiment progress and outcome preserve private protocol refs and effective snapshots", () => {
  const effectiveSpecHash = `sha256:${"4".repeat(64)}`;
  const protocolRef = {
    protocolId: "prot_01K72NVW6Z4QK8VYAVX7GT7S4B",
    protocolRevisionId: `sha256:${"3".repeat(64)}`,
    effectiveSpecHash,
  };
  const effectiveProtocolSnapshot = {
    effectiveSpecHash,
    doseSignature: "Two short sauna sessions weekly",
    modality: "sauna",
    frequency: {
      sessionsPerWeek: 2,
    },
    durationMinutes: {
      target: 12,
    },
    targetSessions: 6,
    minimumUsefulSessions: 4,
  };
  const vault = createExperimentVault();
  vault.experiments = [
    makeExperiment("active", {
      effectiveProtocolSnapshot,
      protocolRef,
    }),
  ];

  const progress = summarizeExperimentProgress(vault, "sauna-rhr", {
    asOf: "2026-04-20",
  });
  const outcome = analyzeExperimentOutcome(vault, "sauna-rhr", {
    asOf: "2026-04-25",
  });

  assert.deepEqual(progress.protocolRef, protocolRef);
  assert.deepEqual(progress.effectiveProtocolSnapshot, effectiveProtocolSnapshot);
  assert.deepEqual(outcome.protocolRef, protocolRef);
  assert.deepEqual(outcome.effectiveProtocolSnapshot, effectiveProtocolSnapshot);
});

test("experiment outcome stays deterministic and expresses uncertainty through confidence reasons", () => {
  const outcome = analyzeExperimentOutcome(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-25",
  });
  const repeatedOutcome = analyzeExperimentOutcome(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-25",
  });

  assert.equal(outcome.schema, "murph.experiment-outcome.v1");
  assert.equal(outcome.schemaVersion, "murph.experiment-outcome.v1");
  assert.equal(outcome.experiment.status, "active");
  assert.equal(outcome.outcomeId, "exp_01JNV4458HYPP53JDQCBP1QJFM-outcome-2026-04-25");
  assert.equal(outcome.commonsProtocolRef?.key, "protocol_variant:dry-sauna/murph-finnish-standard-3x-week");
  assert.equal(outcome.generatedAt, undefined);
  assert.deepEqual(outcome.adherenceSummary, {
    adherenceLevel: "low",
    completedSessions: 3,
    minimumUsefulSessions: 4,
    status: "behind",
    targetSessions: 6,
  });
  assert.deepEqual(outcome.metricResults[0], {
    baselineDayCount: 3,
    baselineMean: 61.33,
    biomarkerKey: "biomarker:resting-heart-rate",
    completeness: "good",
    deltaAbs: -2.66,
    deltaPct: -4.34,
    expectedDirection: "decrease",
    interventionDayCount: 3,
    interventionMean: 58.67,
    intervention: {
      daysWithData: 3,
      mean: 58.67,
      totalDays: 14,
      unit: "bpm",
    },
    label: "Resting Heart Rate",
    movedAsExpected: true,
    unit: "bpm",
    baseline: {
      daysWithData: 3,
      mean: 61.33,
      totalDays: 7,
      unit: "bpm",
    },
  });
  assert.deepEqual(outcome.confidence, {
    level: "low",
    reasons: [
      "Completed session count stayed below the minimum useful target.",
      "Context and confounder logs were present during the run.",
    ],
  });
  assert.deepEqual(outcome.conclusion, {
    caveats: [
      "This is an N-of-1 result, not medical advice.",
      "Concurrent illness, travel, alcohol, training load, and other context can change the readout.",
    ],
    headline: "Resting Heart Rate moved -2.66 bpm during the experiment.",
    plainLanguage:
      "Resting Heart Rate changed from 61.33 to 58.67 bpm. Confidence is low; treat this as associated with the intervention window rather than proof of causation.",
  });
  assert.deepEqual(repeatedOutcome, outcome);
});

test("experiment progress prioritizes safety follow-up over ordinary reminder logic", () => {
  const progress = summarizeExperimentProgress(
    createExperimentVaultWithSafetyFollowUp(),
    "sauna-rhr",
    {
      asOf: "2026-04-20",
    },
  );

  assert.deepEqual(progress.recommendation, {
    action: "summary",
    reason: "A safety-related experiment event was logged and needs follow-up.",
    shouldNotifyUser: true,
  });
  assert.ok(progress.confounders.includes("dizziness context logged on 2026-04-20"));
});

test("completed experiments stay terminal even before the planned intervention window ends", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-completed",
    metadata: null,
    entities: [
      makeExperiment("completed"),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YM",
        occurredAt: "2026-04-09T19:00:00.000Z",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "sauna-rhr", {
    asOf: "2026-04-10",
  });

  assert.equal(progress.phase, "completed");
  assert.deepEqual(progress.recommendation, {
    action: "skip",
    reason: "No wearable data is available yet.",
    shouldNotifyUser: false,
  });
});

test("experiment progress exposes review readiness once the intervention window has ended", () => {
  const progress = summarizeExperimentProgress(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-25",
  });

  assert.equal(progress.phase, "review_due");
  assert.equal(progress.dataCoverage.status, "ready_for_review");
  assert.deepEqual(progress.recommendation, {
    action: "review",
    reason: "The intervention window ended and the experiment is ready for review.",
    shouldNotifyUser: true,
  });
});

test("experiment analysis validates missing and malformed experiment records", () => {
  assert.throws(
    () => summarizeExperimentProgress(createExperimentVault(), "missing-experiment", {
      asOf: "2026-04-10",
    }),
    /Experiment "missing-experiment" was not found/u,
  );

  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-invalid",
    metadata: null,
    entities: [
      makeEntity({
        entityId: "exp_01JNV4458HYPP53JDQCBP1QJFP",
        family: "experiment",
        kind: "experiment_entry",
        recordClass: "bank",
        experimentSlug: "broken-frontmatter",
        attributes: {
          schemaVersion: "murph.frontmatter.experiment.v1",
          docType: "experiment",
          experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFP",
          slug: "broken-frontmatter",
          status: "active",
        },
      }),
    ],
  });

  assert.throws(
    () => analyzeExperimentOutcome(vault, "broken-frontmatter", { asOf: "2026-04-10" }),
    /invalid frontmatter/u,
  );
});

test("experiment progress preserves explicit terminal and planned phases", () => {
  for (const [status, phase] of [
    ["planned", "planned"],
    ["paused", "paused"],
    ["abandoned", "abandoned"],
  ] as const) {
    const vault = createVaultReadModel({
      vaultRoot: `/virtual/experiment-analysis-${status}`,
      metadata: null,
      entities: [makeExperiment(status)],
    });

    assert.equal(
      summarizeExperimentProgress(vault, "sauna-rhr", { asOf: "2026-04-10" }).phase,
      phase,
    );
  }
});

test("experiment progress resolves linked events, skipped sessions, digest reminders, and wearable metric aliases", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFN";
  const experiment = makeExperiment("active", {
    experimentId,
    slug: "sleep-metrics",
    runPlan: {
      baselineStart: "2026-05-01",
      baselineEnd: "2026-05-02",
      interventionStart: "2026-05-03",
      interventionEnd: "2026-05-05",
      targetSessions: 4,
      minimumUsefulSessions: 1,
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:hrv",
      secondaryBiomarkerKeys: [
        "biomarker:resting-heart-rate",
        "biomarker:sleep-efficiency",
        "biomarker:deep-sleep",
        "biomarker:respiratory-rate",
        "biomarker:temperature",
        "biomarker:unknown-signal",
      ],
      desiredDirection: "increase",
      expectedDirections: [
        { biomarkerKey: "biomarker:hrv", direction: "increase" },
        { biomarkerKey: "biomarker:resting-heart-rate", direction: "decrease" },
      ],
    },
    assistantSupport: {
      remindersEnabled: false,
      weeklyDigestEnabled: true,
    },
    protocolRef: null,
  });
  const linkedSession = makeEntity({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2AA",
    family: "event",
    kind: "intervention_session",
    recordClass: "ledger",
    occurredAt: "2026-05-03T19:00:00.000Z",
    date: "2026-05-03",
    experimentSlug: null,
    title: "Linked session",
    attributes: {
      experimentId,
      experimentSlug: "sleep-metrics",
    },
  });
  const skippedSession = makeSession({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2AB",
    occurredAt: "2026-05-04T19:00:00.000Z",
    experimentId,
    experimentSlug: "sleep-metrics",
    sessionStatus: "skipped",
  });
  const unrelatedEarlySession = makeSession({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2AC",
    occurredAt: "2026-04-30T19:00:00.000Z",
    experimentId,
    experimentSlug: "sleep-metrics",
  });
  const futureRelatedSession = makeSession({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2AD",
    occurredAt: "2026-05-09T19:00:00.000Z",
    relatedIds: [experimentId],
    experimentSlug: "sleep-metrics",
  });
  const linkedContext = makeEntity({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2AE",
    family: "event",
    kind: "note",
    recordClass: "ledger",
    occurredAt: "2026-05-04T08:00:00.000Z",
    date: "2026-05-04",
    links: [{ type: "related_to", targetId: experiment.entityId }],
    title: "Late caffeine",
    attributes: {},
  });
  const metrics = [
    makeSample({
      entityId: "sample_sleep_hrv_1",
      dayKey: "2026-05-01",
      stream: "hrv",
      occurredAt: "2026-05-01T06:00:00.000Z",
      unit: "ms",
      value: 45,
    }),
    makeSample({
      entityId: "sample_sleep_hrv_2",
      dayKey: "2026-05-02",
      stream: "hrv",
      occurredAt: "2026-05-02T06:00:00.000Z",
      unit: "ms",
      value: 46,
    }),
    makeSample({
      entityId: "sample_sleep_hrv_3",
      dayKey: "2026-05-03",
      stream: "hrv",
      occurredAt: "2026-05-03T06:00:00.000Z",
      unit: "ms",
      value: 50,
    }),
    makeSample({
      entityId: "sample_sleep_hrv_4",
      dayKey: "2026-05-04",
      stream: "hrv",
      occurredAt: "2026-05-04T06:00:00.000Z",
      unit: "ms",
      value: 51,
    }),
    makeObservation({
      entityId: "evt_sleep_efficiency",
      dayKey: "2026-05-03",
      metric: "sleep-efficiency",
      occurredAt: "2026-05-03T06:00:00.000Z",
      unit: "%",
      value: 89,
    }),
    makeObservation({
      entityId: "evt_deep_sleep",
      dayKey: "2026-05-03",
      metric: "sleep-deep-minutes",
      occurredAt: "2026-05-03T06:00:00.000Z",
      unit: "minutes",
      value: 80,
    }),
    makeObservation({
      entityId: "evt_respiratory_rate",
      dayKey: "2026-05-03",
      metric: "respiratory-rate",
      occurredAt: "2026-05-03T06:00:00.000Z",
      unit: "breaths_per_minute",
      value: 14.5,
    }),
    makeObservation({
      entityId: "evt_temperature",
      dayKey: "2026-05-03",
      metric: "temperature-deviation",
      occurredAt: "2026-05-03T06:00:00.000Z",
      unit: "celsius",
      value: 0.2,
    }),
    makeObservation({
      entityId: "evt_rhr_baseline",
      dayKey: "2026-05-01",
      metric: "resting-heart-rate",
      occurredAt: "2026-05-01T06:00:00.000Z",
      unit: "bpm",
      value: 50,
    }),
    makeObservation({
      entityId: "evt_rhr_intervention",
      dayKey: "2026-05-03",
      metric: "resting-heart-rate",
      occurredAt: "2026-05-03T06:00:00.000Z",
      unit: "bpm",
      value: 48,
    }),
  ];
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-metrics",
    metadata: null,
    entities: [
      experiment,
      linkedSession,
      skippedSession,
      unrelatedEarlySession,
      futureRelatedSession,
      linkedContext,
      ...metrics,
    ],
  });

  const progress = summarizeExperimentProgress(vault, "sleep-metrics", {
    asOf: "2026-05-04",
  });

  assert.equal(progress.phase, "intervention");
  assert.deepEqual(progress.adherence, {
    completedSessions: 1,
    expectedSessionsByNow: 2,
    minimumUsefulSessions: 1,
    sessionEventIds: ["evt_01JNV45RHN0TQ9ZXE0A7YSE2AA"],
    status: "met_minimum",
    targetSessions: 4,
  });
  assert.deepEqual(progress.recommendation, {
    action: "summary",
    reason: "A weekly digest is enabled and wearable data is available.",
    shouldNotifyUser: true,
  });
  assert.deepEqual(
    progress.signals.map((signal) => [signal.biomarkerKey, signal.unit]),
    [
      ["biomarker:hrv", "ms"],
      ["biomarker:resting-heart-rate", "bpm"],
      ["biomarker:sleep-efficiency", "percent"],
      ["biomarker:deep-sleep", "minutes"],
      ["biomarker:respiratory-rate", "breaths/min"],
      ["biomarker:temperature", "degC"],
      ["biomarker:unknown-signal", null],
    ],
  );
  assert.equal(progress.signals[0]?.deltaAbs, 5);
  assert.equal(progress.signals[0]?.movedAsExpected, true);
  assert.equal(progress.signals[1]?.expectedDirection, "decrease");
  assert.equal(progress.signals[1]?.deltaAbs, -2);
  assert.equal(progress.signals[1]?.movedAsExpected, true);
  assert.equal(progress.signals[2]?.expectedDirection, null);
  assert.equal(progress.signals[6]?.completeness, "insufficient");
  assert.deepEqual(progress.confounders, ["Late caffeine on 2026-05-04"]);
  assert.equal(progress.protocolRef, null);
});

test("experiment follow-up due notifies for an unlogged daily missed-log date", () => {
  const experiment = makeExperiment("active", {
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-07",
      interventionStart: "2026-04-08",
      interventionEnd: "2026-04-21",
      sessionsPerWeek: 7,
      targetSessions: 14,
      minimumUsefulSessions: 10,
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-due",
    metadata: { timezone: "Asia/Singapore" },
    entities: [experiment],
  });

  const decision = decideExperimentFollowupDue(vault, "sauna-rhr", {
    kind: "missed-log",
    date: "2026-04-10",
  });

  assert.equal(decision.action, "notify");
  assert.equal(decision.reason, "planned_session_log_missing");
  assert.equal(decision.window.sessionDate, "2026-04-10");
  assert.equal(
    decision.dedupeKey,
    "experiment-followup:exp_01JNV4458HYPP53JDQCBP1QJFM:missed-log:2026-04-10",
  );
});

test("experiment follow-up due skips missed-log when the date already has any session log", () => {
  const experiment = makeExperiment("active", {
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-07",
      interventionStart: "2026-04-08",
      interventionEnd: "2026-04-21",
      targetSessions: 14,
      minimumUsefulSessions: 10,
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const skippedSession = makeSession({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2BA",
    occurredAt: "2026-04-10T19:00:00.000Z",
    sessionStatus: "skipped",
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-logged",
    metadata: null,
    entities: [experiment, skippedSession],
  });

  const decision = decideExperimentFollowupDue(vault, "sauna-rhr", {
    kind: "missed-log",
    date: "2026-04-10",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "session_already_logged");
});

test("experiment follow-up due skips missed-log for opt-out and unsupported schedules", () => {
  const optedOut = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-opt-out",
    metadata: null,
    entities: [
      makeExperiment("active", {
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-21",
          targetSessions: 14,
          minimumUsefulSessions: 10,
        },
        assistantSupport: {
          remindersEnabled: true,
          missedLogFollowup: "never",
          weeklyDigestEnabled: false,
        },
      }),
    ],
  });
  const nonDaily = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-nondaily",
    metadata: null,
    entities: [
      makeExperiment("active", {
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-21",
          sessionsPerWeek: 3,
          targetSessions: 6,
          minimumUsefulSessions: 4,
        },
        assistantSupport: {
          remindersEnabled: true,
          missedLogFollowup: "default_on",
          weeklyDigestEnabled: false,
        },
      }),
    ],
  });

  assert.equal(
    decideExperimentFollowupDue(optedOut, "sauna-rhr", {
      kind: "missed-log",
      date: "2026-04-10",
    }).reason,
    "missed_log_followup_disabled",
  );
  assert.equal(
    decideExperimentFollowupDue(nonDaily, "sauna-rhr", {
      kind: "missed-log",
      date: "2026-04-10",
    }).reason,
    "unsupported_session_schedule",
  );
});

test("experiment follow-up due evaluates weekly digest enablement", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-weekly-digest",
    metadata: null,
    entities: [
      makeExperiment("active", {
        assistantSupport: {
          remindersEnabled: false,
          weeklyDigestEnabled: true,
        },
      }),
    ],
  });

  const earlyDecision = decideExperimentFollowupDue(vault, "sauna-rhr", {
    kind: "weekly-digest",
    date: "2026-04-10",
  });
  const decision = decideExperimentFollowupDue(vault, "sauna-rhr", {
    kind: "weekly-digest",
    date: "2026-04-14",
  });
  const afterInterventionDecision = decideExperimentFollowupDue(vault, "sauna-rhr", {
    kind: "weekly-digest",
    date: "2026-04-28",
  });

  assert.equal(earlyDecision.action, "skip");
  assert.equal(earlyDecision.reason, "weekly_digest_not_due");
  assert.equal(decision.action, "notify");
  assert.equal(decision.reason, "weekly_digest_due");
  assert.equal(decision.dedupeKey.endsWith(":weekly-digest:2026-04-14"), true);
  assert.equal(afterInterventionDecision.action, "skip");
  assert.equal(afterInterventionDecision.reason, "weekly_digest_not_due");
});

test("experiment outcome reports sparse primary data as medium-confidence incomplete evidence", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFR",
    slug: "no-primary-data",
    protocolRef: null,
    runPlan: {},
    analysisPlan: {},
    assistantSupport: {},
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-sparse",
    metadata: null,
    entities: [experiment],
  });

  const outcome = analyzeExperimentOutcome(vault, "no-primary-data", {
    asOf: "2026-06-01",
  });

  assert.deepEqual(outcome.adherenceSummary, {
    adherenceLevel: "unknown",
    completedSessions: 0,
    minimumUsefulSessions: null,
    status: "not_started",
    targetSessions: null,
  });
  assert.deepEqual(outcome.confidence, {
    level: "medium",
    reasons: [
      "Primary biomarker coverage is insufficient for a strong before-and-after read.",
    ],
  });
  assert.deepEqual(outcome.metricResults, []);
  assert.equal(
    outcome.conclusion.headline,
    "The experiment finished, but the primary biomarker readout is incomplete.",
  );
  assert.match(outcome.conclusion.plainLanguage, /not enough primary biomarker data/u);
  assert.equal(outcome.protocolRef, null);
});

test("buildExperimentProgressCard projects the run window onto a weekly grid", () => {
  const vault = createExperimentVault();
  const { card, warnings } = buildExperimentProgressCard(vault, "sauna-rhr", {
    asOf: "2026-04-12",
    confounders: [{ date: "2026-04-09", label: "Alcohol (~5 drinks)" }],
  });

  // The sessions strip covers the intervention window only (04-08..04-21 =
  // 14 days = 2 weeks); the baseline period is measurement-only and excluded.
  assert.equal(card.weeks.length, 2);
  assert.ok(card.weeks.length <= EXPERIMENT_PROGRESS_CARD_MAX_WEEKS);
  assert.equal(card.weeks[0].start, "2026-04-08");
  // No baseline "B" cells, and every code is a valid intervention-window code.
  const cells = card.weeks.map((week) => week.cells).join("");
  assert.match(cells, /^[CPMNSO]+$/u);
  assert.equal(cells.includes("B"), false);
  // Phase still reflects the whole run (baseline + intervention).
  assert.equal(card.phase.totalDays, 21);
  assert.equal(card.phase.day, 12);
  assert.equal(card.sessions.logged, 2);
  assert.equal(card.sessions.target, 6);
  // Confounder annotations pass through verbatim.
  assert.deepEqual(card.confounders, [
    { date: "2026-04-09", label: "Alcohol (~5 drinks)" },
  ]);
  assert.deepEqual(warnings, []);
});

test("buildExperimentProgressCard marks logged intervention days as completed", () => {
  // A daily-schedule run synthesizes an adherence calendar, so logged sessions
  // resolve to "C" cells and unlogged-but-due days to "M".
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-progress-card",
    metadata: null,
    entities: [
      makeExperiment("active", {
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-14",
          modality: "sauna",
          targetSessions: 7,
          schedule: {
            kind: "dailyLocal",
            localTime: "19:00",
            timeZone: "America/New_York",
          },
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE201",
        occurredAt: "2026-04-08T23:30:00.000Z",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE202",
        occurredAt: "2026-04-09T23:30:00.000Z",
      }),
    ],
  });

  const { card } = buildExperimentProgressCard(vault, "sauna-rhr", {
    asOf: "2026-04-11",
  });

  assert.equal(card.weeks[0].start, "2026-04-08");
  // 04-08 and 04-09 logged → completed; later days stay scheduled until their
  // grace window lapses.
  assert.match(card.weeks[0].cells, /^CC/u);
  assert.equal(card.weeks[0].cells.includes("B"), false);
  assert.ok(card.sessions.logged >= 2);
});

test("buildExperimentProgressCard surfaces the resting-heart-rate mover with downward sentiment", () => {
  const { card } = buildExperimentProgressCard(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-12",
  });

  assert.ok(card.movers.length >= 1);
  const rhr = card.movers[0];
  assert.match(rhr.label, /heart rate/iu);
  // RHR fell from baseline, and the analysis plan wants a decrease → positive.
  assert.equal(rhr.direction, "down");
  assert.equal(rhr.sentiment, "positive");
  // The headline is an unsigned percent-change magnitude; the arrow shows direction.
  assert.match(rhr.changePct, /^\d+(?:\.\d+)?%$/u);
  // The raw change keeps its sign (a fall reads with a minus) and carries the unit.
  assert.match(rhr.delta, /^−.*bpm$/u);
});

test("buildExperimentProgressCard uses display-grade metric samples for movers", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJMS",
    slug: "metric-sample-sleep",
    runPlan: {
      baselineStart: "2026-06-01",
      baselineEnd: "2026-06-03",
      interventionStart: "2026-06-04",
      interventionEnd: "2026-06-06",
      modality: "sleep",
      targetSessions: 3,
      minimumUsefulSessions: 1,
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:sleep-efficiency",
      secondaryBiomarkerKeys: [
        "biomarker:deep-sleep-minutes",
        "biomarker:resting-heart-rate",
      ],
      expectedDirections: [
        { biomarkerKey: "biomarker:sleep-efficiency", direction: "increase" },
        { biomarkerKey: "biomarker:deep-sleep-minutes", direction: "increase" },
        { biomarkerKey: "biomarker:resting-heart-rate", direction: "decrease" },
      ],
    },
  });
  const metricSamples = [
    ["2026-06-01", "sleep-efficiency", "percent", 94.8],
    ["2026-06-02", "sleep-efficiency", "percent", 94.8],
    ["2026-06-03", "sleep-efficiency", "percent", 94.8],
    ["2026-06-04", "sleep-efficiency", "percent", 94.1],
    ["2026-06-05", "sleep-efficiency", "percent", 94.1],
    ["2026-06-06", "sleep-efficiency", "percent", 94.1],
    ["2026-06-01", "deep-sleep-minutes", "minutes", 96.4],
    ["2026-06-02", "deep-sleep-minutes", "minutes", 96.4],
    ["2026-06-03", "deep-sleep-minutes", "minutes", 96.4],
    ["2026-06-04", "deep-sleep-minutes", "minutes", 113.8],
    ["2026-06-05", "deep-sleep-minutes", "minutes", 113.8],
    ["2026-06-06", "deep-sleep-minutes", "minutes", 113.8],
    ["2026-06-01", "resting-heart-rate", "bpm", 50.4],
    ["2026-06-02", "resting-heart-rate", "bpm", 50.4],
    ["2026-06-03", "resting-heart-rate", "bpm", 50.4],
    ["2026-06-04", "resting-heart-rate", "bpm", 47.1],
    ["2026-06-05", "resting-heart-rate", "bpm", 47.1],
    ["2026-06-06", "resting-heart-rate", "bpm", 47.1],
  ].map(([dayKey, metric, unit, value], index) =>
    makeMetricSample({
      dayKey: String(dayKey),
      entityId: `smp_progress_card_${index}`,
      metric: String(metric),
      occurredAt: `${String(dayKey)}T06:00:00.000Z`,
      unit: String(unit),
      value: Number(value),
    })
  );
  const rawMetricSamples = [
    ["2026-06-04", "sleep-efficiency", "percent", 10],
    ["2026-06-05", "deep-sleep-minutes", "minutes", 300],
    ["2026-06-06", "resting-heart-rate", "bpm", 120],
  ].map(([dayKey, metric, unit, value], index) =>
    makeMetricSample({
      dayKey: String(dayKey),
      entityId: `smp_progress_card_raw_${index}`,
      metric: String(metric),
      occurredAt: `${String(dayKey)}T06:00:00.000Z`,
      quality: "raw",
      source: "vendor_raw",
      unit: String(unit),
      value: Number(value),
    })
  );
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-progress-card-metric-samples",
    metadata: null,
    entities: [experiment, ...metricSamples, ...rawMetricSamples],
  });

  const progress = summarizeExperimentProgress(vault, "metric-sample-sleep", {
    asOf: "2026-06-06",
  });
  assert.deepEqual(progress.dataCoverage, {
    baselineDaysAvailable: 3,
    interventionDaysAvailable: 3,
    primaryBiomarkerKey: "biomarker:sleep-efficiency",
    primaryMetricDaysAvailable: 6,
    status: "sufficient_for_progress",
    wearableProviders: [],
  });
  assert.deepEqual(
    progress.signals.map((signal) => [
      signal.biomarkerKey,
      signal.completeness,
      signal.baselineMean,
      signal.interventionMean,
      signal.deltaAbs,
    ]),
    [
      ["biomarker:sleep-efficiency", "good", 94.8, 94.1, -0.7],
      ["biomarker:deep-sleep-minutes", "good", 96.4, 113.8, 17.4],
      ["biomarker:resting-heart-rate", "good", 50.4, 47.1, -3.3],
    ],
  );

  const { card, warnings } = buildExperimentProgressCard(vault, "metric-sample-sleep", {
    asOf: "2026-06-06",
  });
  assert.equal(card.movers.length, 2);
  assert.deepEqual(card.movers.map((mover) => mover.label), [
    "Deep Sleep Minutes",
    "Resting Heart Rate",
  ]);
  assert.equal(warnings.at(-1), "movers clamped to top 2 of 3 qualifying metrics");
});

test("buildExperimentProgressCard compares run windows with canonical metric units", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGS",
    slug: "mixed-unit-weight",
    runPlan: {
      baselineStart: "2026-06-01",
      baselineEnd: "2026-06-03",
      interventionStart: "2026-06-04",
      interventionEnd: "2026-06-06",
      modality: "nutrition",
      targetSessions: 3,
      minimumUsefulSessions: 1,
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:body-weight",
      desiredDirection: "decrease",
    },
  });
  const metricSamples = [
    ["2026-06-01", "kg", 80],
    ["2026-06-02", "kg", 80],
    ["2026-06-03", "kg", 80],
    ["2026-06-04", "lb", 180],
    ["2026-06-05", "lb", 180],
    ["2026-06-06", "lb", 180],
  ].map(([dayKey, unit, value], index) =>
    makeMetricSample({
      dayKey: String(dayKey),
      entityId: `smp_weight_mixed_unit_${index}`,
      metric: "body-weight",
      occurredAt: `${String(dayKey)}T06:00:00.000Z`,
      unit: String(unit),
      value: Number(value),
    })
  );
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-progress-card-canonical-units",
    metadata: null,
    entities: [experiment, ...metricSamples],
  });

  const progress = summarizeExperimentProgress(vault, "mixed-unit-weight", {
    asOf: "2026-06-06",
  });
  const signal = progress.signals[0];
  assert.equal(signal?.biomarkerKey, "biomarker:body-weight");
  assert.equal(signal?.baselineMean, 80);
  assert.equal(signal?.interventionMean, 81.65);
  assert.equal(signal?.deltaAbs, 1.65);
  assert.equal(signal?.unit, "kg");

  const { card } = buildExperimentProgressCard(vault, "mixed-unit-weight", {
    asOf: "2026-06-06",
  });
  assert.equal(card.movers.length, 1);
  assert.equal(card.movers[0]?.label, "Body Weight");
  assert.equal(card.movers[0]?.delta, "+1.7 kg");
});

test("buildExperimentProgressCard keeps glucose sample-summary points in run windows", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGT",
    slug: "glucose-samples",
    runPlan: {
      baselineStart: "2026-06-01",
      baselineEnd: "2026-06-03",
      interventionStart: "2026-06-04",
      interventionEnd: "2026-06-06",
      modality: "nutrition",
      targetSessions: 3,
      minimumUsefulSessions: 1,
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:blood-glucose",
      desiredDirection: "decrease",
    },
  });
  const glucoseSamples = [
    ["2026-06-01", 96],
    ["2026-06-02", 96],
    ["2026-06-03", 96],
    ["2026-06-04", 102],
    ["2026-06-05", 102],
    ["2026-06-06", 102],
  ].map(([dayKey, value], index) =>
    makeSample({
      dayKey: String(dayKey),
      entityId: `smp_glucose_progress_${index}`,
      occurredAt: `${String(dayKey)}T12:00:00.000Z`,
      stream: "glucose",
      unit: "mg_dL",
      value: Number(value),
    })
  );
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-progress-card-glucose-samples",
    metadata: null,
    entities: [experiment, ...glucoseSamples],
  });

  const progress = summarizeExperimentProgress(vault, "glucose-samples", {
    asOf: "2026-06-06",
  });
  const signal = progress.signals[0];
  assert.equal(signal?.biomarkerKey, "biomarker:blood-glucose");
  assert.equal(signal?.baselineMean, 96);
  assert.equal(signal?.interventionMean, 102);
  assert.equal(signal?.deltaAbs, 6);
  assert.equal(signal?.unit, "mg/dL");

  const { card } = buildExperimentProgressCard(vault, "glucose-samples", {
    asOf: "2026-06-06",
  });
  assert.equal(card.movers.length, 1);
  assert.match(card.movers[0]?.label ?? "", /glucose/iu);
  assert.equal(card.movers[0]?.delta, "+6 mg/dL");
});

test("buildExperimentProgressCard emits a card-route path that decodes back to the card", () => {
  const { card } = buildExperimentProgressCard(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-12",
  });
  const path = buildExperimentProgressCardPath(
    "exp_01JNV4458HYPP53JDQCBP1QJFM",
    card,
  );

  assert.match(
    path,
    /^\/experiments\/exp_[0-9A-HJKMNP-TV-Z]{26}\/progress-card\/[A-Za-z0-9_-]+\.png$/u,
  );
  const payload = path.slice(path.lastIndexOf("/") + 1, -".png".length);
  assert.deepEqual(decodeExperimentProgressCard(payload), card);
});
