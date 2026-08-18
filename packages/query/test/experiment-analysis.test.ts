import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  analyzeExperimentOutcome,
  collectExperimentAdherenceCalendar,
  decideExperimentFollowupDue,
  summarizeExperimentProgress,
  type MetricPoint,
} from "../src/index.ts";
import {
  type ExperimentAdherenceTarget,
} from "@murphai/contracts";
import { countCompletedAdherenceSessions } from "../src/experiment-adherence.ts";

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
  unit: string | null;
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
  date?: string;
  experimentId?: string;
  experimentSlug?: string;
  fields?: Record<string, string | number | boolean | null>;
  interventionType?: string;
  relatedIds?: string[];
  scheduledLocalDate?: string;
  sessionLocalDate?: string;
  sessionStatus?: string;
  source?: string;
  symptoms?: string[];
}): CanonicalEntity {
  const dayKey = input.date ?? input.occurredAt.slice(0, 10);
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
      fields: input.fields,
      interventionType: input.interventionType,
      scheduledLocalDate: input.scheduledLocalDate,
      sessionLocalDate: input.sessionLocalDate,
      sessionStatus: input.sessionStatus,
      ...(input.source === undefined ? {} : { source: input.source }),
      symptoms: input.symptoms,
    },
  });
}

test("declared subjective session fields become primary experiment metric windows", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGW";
  const slug = "subjective-sleep-onset";
  const sessions = [
    ["evt_01JNV45RHN0TQ9ZXE0A7YSE3AA", "2026-04-01", 45],
    ["evt_01JNV45RHN0TQ9ZXE0A7YSE3AB", "2026-04-02", 40],
    ["evt_01JNV45RHN0TQ9ZXE0A7YSE3AC", "2026-04-03", 35],
    ["evt_01JNV45RHN0TQ9ZXE0A7YSE3AD", "2026-04-04", 25],
    ["evt_01JNV45RHN0TQ9ZXE0A7YSE3AE", "2026-04-05", 20],
    ["evt_01JNV45RHN0TQ9ZXE0A7YSE3AF", "2026-04-06", 15],
  ] as const;
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-subjective-sleep",
    metadata: { timezone: "UTC" },
    entities: [
      makeExperiment("active", {
        experimentId,
        slug,
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-03",
          interventionStart: "2026-04-04",
          interventionEnd: "2026-04-06",
          modality: "sleep routine",
          targetSessions: 3,
          minimumUsefulSessions: 2,
          logging: {
            sessionFields: ["estimated-sleep-onset-minutes"],
          },
        },
        analysisPlan: {
          primaryBiomarkerKey: "biomarker:sleep-onset-latency",
          desiredDirection: "decrease",
        },
      }),
      ...sessions.map(([entityId, date, value]) => makeSession({
        entityId,
        experimentId,
        experimentSlug: slug,
        occurredAt: `${date}T08:00:00.000Z`,
        sessionLocalDate: date,
        fields: { "estimated-sleep-onset-minutes": value },
      })),
      ...sessions.map(([entityId, date]) => makeSession({
        entityId: `${entityId}_other_run`,
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGX",
        experimentSlug: "other-subjective-sleep-run",
        occurredAt: `${date}T09:00:00.000Z`,
        sessionLocalDate: date,
        fields: { "estimated-sleep-onset-minutes": 700 },
      })),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3AG",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGX",
        experimentSlug: slug,
        occurredAt: "2026-04-01T10:00:00.000Z",
        sessionLocalDate: "2026-04-01",
        fields: { "estimated-sleep-onset-minutes": 700 },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3AH",
        experimentId,
        experimentSlug: slug,
        occurredAt: "2026-04-01T11:00:00.000Z",
        sessionLocalDate: "2026-04-01",
        fields: { subjective_sleep_quality: 1 },
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, slug, { asOf: "2026-04-06" });
  const outcome = analyzeExperimentOutcome(vault, slug, { asOf: "2026-04-06" });

  assert.deepEqual(progress.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.deepEqual(progress.signals[0], {
    baseline: { daysWithData: 3, mean: 40, totalDays: 3, unit: "minutes" },
    baselineDayCount: 3,
    baselineMean: 40,
    biomarkerKey: "biomarker:sleep-onset-latency",
    completeness: "good",
    deltaAbs: -20,
    deltaPct: -50,
    expectedDirection: "decrease",
    intervention: { daysWithData: 3, mean: 20, totalDays: 3, unit: "minutes" },
    interventionDayCount: 3,
    interventionMean: 20,
    label: "Sleep Onset Latency",
    movedAsExpected: true,
    unit: "minutes",
  });
  assert.equal(outcome.metricResults[0]?.baselineMean, 40);
  assert.equal(outcome.metricResults[0]?.interventionMean, 20);
});

test("bedtime delay diary values form bounded baseline and intervention windows", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGY";
  const slug = "bedtime-delay";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-bedtime-delay",
    metadata: { timezone: "UTC" },
    entities: [
      makeExperiment("active", {
        experimentId,
        slug,
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-02",
          interventionStart: "2026-04-03",
          interventionEnd: "2026-04-04",
          modality: "bedtime transition",
          logging: { sessionFields: ["bedtime_delay_minutes"] },
        },
        analysisPlan: {
          primaryBiomarkerKey: "biomarker:bedtime-delay",
          desiredDirection: "decrease",
        },
      }),
      ...[
        ["evt_01JNV45RHN0TQ9ZXE0A7YSE4AA", "2026-04-01", 30],
        ["evt_01JNV45RHN0TQ9ZXE0A7YSE4AB", "2026-04-02", 45],
        ["evt_01JNV45RHN0TQ9ZXE0A7YSE4AC", "2026-04-03", 10],
        ["evt_01JNV45RHN0TQ9ZXE0A7YSE4AD", "2026-04-04", 0],
      ].map(([entityId, date, value]) => makeSession({
        entityId: String(entityId),
        experimentId,
        experimentSlug: slug,
        occurredAt: `${date}T08:00:00.000Z`,
        sessionLocalDate: String(date),
        fields: { bedtime_delay_minutes: Number(value) },
      })),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE4AE",
        experimentId,
        experimentSlug: slug,
        occurredAt: "2026-04-04T09:00:00.000Z",
        sessionLocalDate: "2026-04-04",
        fields: { bedtime_delay_minutes: 721 },
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, slug, { asOf: "2026-04-04" });
  const outcome = analyzeExperimentOutcome(vault, slug, { asOf: "2026-04-04" });

  assert.deepEqual(progress.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.deepEqual(progress.signals[0], {
    baseline: { daysWithData: 2, mean: 37.5, totalDays: 2, unit: "minutes" },
    baselineDayCount: 2,
    baselineMean: 37.5,
    biomarkerKey: "biomarker:bedtime-delay",
    completeness: "partial",
    deltaAbs: -32.5,
    deltaPct: -86.67,
    expectedDirection: "decrease",
    intervention: { daysWithData: 2, mean: 5, totalDays: 2, unit: "minutes" },
    interventionDayCount: 2,
    interventionMean: 5,
    label: "Bedtime Delay",
    movedAsExpected: true,
    unit: "minutes",
  });
  assert.equal(outcome.metricResults[0]?.baselineMean, 37.5);
  assert.equal(outcome.metricResults[0]?.interventionMean, 5);
});

test("analysis readiness rejects unsupported and undeclared subjective primary outcomes", () => {
  const unsupported = summarizeExperimentProgress(createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-unsupported-primary",
    metadata: null,
    entities: [makeExperiment("active", {
      slug: "unsupported-primary",
      analysisPlan: { primaryBiomarkerKey: "biomarker:not-a-real-metric" },
    })],
  }), "unsupported-primary", { asOf: "2026-04-10" });
  const undeclared = summarizeExperimentProgress(createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-uncapturable-primary",
    metadata: null,
    entities: [makeExperiment("active", {
      slug: "uncapturable-primary",
      analysisPlan: { primaryBiomarkerKey: "biomarker:sleep-onset-latency" },
    })],
  }), "uncapturable-primary", { asOf: "2026-04-10" });
  const ambiguous = summarizeExperimentProgress(createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-ambiguous-primary",
    metadata: null,
    entities: [makeExperiment("active", {
      slug: "ambiguous-primary",
      analysisPlan: { primaryBiomarkerKey: "biomarker:sleep-onset-latency" },
      runPlan: {
        logging: {
          sessionFields: [
            "sleep-onset-latency-minutes",
            "estimated_sleep_onset_minutes",
          ],
        },
      },
    })],
  }), "ambiguous-primary", { asOf: "2026-04-10" });

  assert.equal(unsupported.analysisReadiness.status, "incomplete");
  assert.equal(
    unsupported.analysisReadiness.blockingReasons.includes("unsupported_primary_biomarker"),
    true,
  );
  assert.equal(undeclared.analysisReadiness.status, "incomplete");
  assert.equal(
    undeclared.analysisReadiness.blockingReasons.includes("uncapturable_primary_biomarker"),
    true,
  );
  assert.equal(ambiguous.analysisReadiness.status, "incomplete");
  assert.equal(
    ambiguous.analysisReadiness.blockingReasons.includes("uncapturable_primary_biomarker"),
    true,
  );
});

function makeActivitySession(input: {
  activityType: string;
  dataOrigin?: Record<string, unknown>;
  dayKey: string;
  durationMinutes?: number;
  entityId: string;
  externalRef?: Record<string, unknown>;
  name?: string;
  occurredAt?: string;
  provider?: string;
  source?: string;
  sportName?: string;
  title?: string;
  workout?: Record<string, unknown>;
}): CanonicalEntity {
  const externalRef = input.externalRef ??
    (input.provider
      ? {
          resourceId: input.entityId,
          resourceType: "activity_session",
          system: input.provider,
        }
      : undefined);

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
      ...(input.dataOrigin === undefined ? {} : { dataOrigin: input.dataOrigin }),
      ...(input.durationMinutes === undefined
        ? {}
        : { durationMinutes: input.durationMinutes }),
      ...(externalRef === undefined ? {} : { externalRef }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.provider === undefined && input.source === undefined ? {} : { source: input.source ?? "device" }),
      ...(input.sportName === undefined ? {} : { sportName: input.sportName }),
      ...(input.workout === undefined ? {} : { workout: input.workout }),
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
    evidence: { eventKind: "intervention_session" },
    expectedSessionsByNow: 5,
    loggedSessions: 3,
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
    activityProviders: [],
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

test("experiment data coverage keeps wearable summaries separate from activity capability", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-sleep-recovery-only-coverage",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGA",
        slug: "sleep-recovery-only",
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-21",
          modality: "sleep",
          targetSessions: 14,
          minimumUsefulSessions: 7,
        },
        analysisPlan: {
          primaryBiomarkerKey: "biomarker:sleep-score",
          desiredDirection: "increase",
        },
      }),
      makeObservation({
        entityId: "evt_sleep_score_summary",
        dayKey: "2026-04-02",
        metric: "sleep-score",
        occurredAt: "2026-04-02T06:00:00.000Z",
        unit: "score",
        value: 82,
      }),
      makeObservation({
        entityId: "evt_recovery_score_summary",
        dayKey: "2026-04-09",
        metric: "recovery-score",
        occurredAt: "2026-04-09T06:00:00.000Z",
        unit: "score",
        value: 71,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "sleep-recovery-only", { asOf: "2026-04-10" });

  assert.deepEqual(progress.dataCoverage.activityProviders, []);
  assert.deepEqual(progress.dataCoverage.wearableProviders, ["whoop"]);
});

test("experiment data coverage ignores activity provider history outside the current coverage window", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-activity-provider-capability",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGB",
        slug: "fresh-run-block",
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
      makeActivitySession({
        entityId: "evt_whoop_old_run",
        dayKey: "2026-04-12",
        activityType: "Running",
        provider: "whoop",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "fresh-run-block", { asOf: "2026-06-09" });

  assert.deepEqual(progress.dataCoverage.activityProviders, []);
  assert.deepEqual(progress.dataCoverage.wearableProviders, []);
});

test("experiment data coverage reports recent activity provider capability", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-recent-activity-provider-capability",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGC",
        slug: "recent-run-block",
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
      makeActivitySession({
        entityId: "evt_whoop_recent_run",
        dayKey: "2026-06-02",
        activityType: "Running",
        provider: "whoop",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "recent-run-block", { asOf: "2026-06-09" });

  assert.deepEqual(progress.dataCoverage.activityProviders, ["whoop"]);
  assert.deepEqual(progress.dataCoverage.wearableProviders, []);
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
  assert.deepEqual(progress.adherence.evidence, {
    eventKind: "activity_session",
    activityKind: "running",
  });
  assert.equal(progress.adherence.status, "behind");
  assert.equal(progress.adherence.targetSessions, 24);
});

test("experiment progress counts cycling adherence from provider ride activity sessions", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-cycling-ride-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFP",
        slug: "cycling-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Cycling",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeActivitySession({
        entityId: "evt_ride_1",
        dayKey: "2026-06-02",
        activityType: "ride",
        sportName: "Ride",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "cycling-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 1);
});

test("experiment progress uses the protocol snapshot's accepted activity kinds", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-zone-2-activity-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJZ2",
        slug: "zone-2-block",
        commonsProtocolRef: {
          key: "protocol_variant:aerobic-base-training/zone-2-aerobic-base-block",
          pageRevisionId: "sha256:page-revision",
          runSpecRevisionId: "sha256:run-spec-revision",
          testPlanId: "zone2-aerobic-base-readout",
        },
        effectiveProtocolSnapshot: {
          effectiveSpecHash: `sha256:${"4".repeat(64)}`,
          doseSignature: "3x/week easy cardio, 35-60 min",
          modality: "sustainable easy aerobic volume",
          activitySessionEvidence: {
            activityKinds: ["walking", "cycling", "rowing", "elliptical"],
            minimumDurationMinutes: 35,
          },
          targetSessions: 12,
          minimumUsefulSessions: 9,
        },
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Cycling",
          targetSessions: 12,
          minimumUsefulSessions: 9,
        },
      }),
      makeActivitySession({
        entityId: "evt_zone_2_walk",
        dayKey: "2026-06-01",
        activityType: "Walking",
        durationMinutes: 40,
      }),
      makeActivitySession({
        entityId: "evt_zone_2_elliptical",
        dayKey: "2026-06-02",
        activityType: "Elliptical",
        durationMinutes: 45,
      }),
      makeActivitySession({
        entityId: "evt_zone_2_row",
        dayKey: "2026-06-03",
        activityType: "Rowing",
        durationMinutes: 35,
      }),
      makeActivitySession({
        entityId: "evt_zone_2_short_ride",
        dayKey: "2026-06-04",
        activityType: "Cycling",
        durationMinutes: 20,
      }),
      makeActivitySession({
        entityId: "evt_zone_2_run",
        dayKey: "2026-06-05",
        activityType: "Running",
        durationMinutes: 50,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "zone-2-block", {
    asOf: "2026-06-09",
  });

  assert.equal(progress.adherence.completedSessions, 3);
  assert.deepEqual(progress.adherence.evidence, {
    eventKind: "activity_session",
    activityKinds: ["walking", "cycling", "rowing", "elliptical"],
    minimumDurationMinutes: 35,
  });
});

test("experiment progress counts any activity session for generic workout modality", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-generic-workout-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGC",
        slug: "generic-workout-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Workout",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeActivitySession({ entityId: "evt_generic_workout_ride", dayKey: "2026-06-02", activityType: "Cycling" }),
      makeActivitySession({ entityId: "evt_generic_workout_strength", dayKey: "2026-06-04", activityType: "Strength" }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "generic-workout-block", { asOf: "2026-06-09" });

  assert.deepEqual(progress.adherence.evidence, {
    eventKind: "activity_session",
  });
  assert.equal(progress.adherence.completedSessions, 2);
});

test("experiment progress classifies nested workout sport before generic activity labels", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-nested-workout-run-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFR",
        slug: "nested-workout-run-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Run",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeActivitySession({
        entityId: "evt_workout_run_1",
        dayKey: "2026-06-02",
        activityType: "workout",
        workout: { sportName: "Run" },
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "nested-workout-run-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 1);
});

test("experiment progress ignores fully generic activity sessions for running adherence", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-generic-workout-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFS",
        slug: "generic-workout-run-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Run",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeActivitySession({
        entityId: "evt_generic_workout_1",
        dayKey: "2026-06-02",
        activityType: "workout",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "generic-workout-run-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 0);
});

test("experiment progress ignores free-text activity names for running adherence", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-free-text-workout-name-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFT",
        slug: "free-text-workout-name-run-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Run",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeActivitySession({
        entityId: "evt_generic_named_workout_1",
        dayKey: "2026-06-02",
        activityType: "workout",
        name: "post run mobility",
        workout: { name: "post run mobility" },
      }),
      makeActivitySession({
        entityId: "evt_structured_run_1",
        dayKey: "2026-06-03",
        activityType: "workout",
        sportName: "Run",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "free-text-workout-name-run-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 1);
});

test("experiment progress counts count-less run-plan device sessions", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-countless-running-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGA",
        slug: "countless-run-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Run",
        },
      }),
      makeActivitySession({
        entityId: "evt_countless_run_1",
        dayKey: "2026-06-02",
        activityType: "workout",
        sportName: "Run",
      }),
      makeActivitySession({
        entityId: "evt_countless_run_2",
        dayKey: "2026-06-05",
        activityType: "workout",
        sportName: "Run",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "countless-run-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 2);
  assert.equal(progress.adherence.expectedSessionsByNow, null);
  assert.notEqual(progress.adherence.status, "not_started");
});

test("experiment progress counts count-less run-plan manual sessions", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGB";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-countless-sauna-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug: "countless-sauna-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "sauna",
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2GA",
        experimentId,
        experimentSlug: "countless-sauna-block",
        occurredAt: "2026-06-02T19:00:00.000Z",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2GB",
        experimentId,
        experimentSlug: "countless-sauna-block",
        occurredAt: "2026-06-05T19:00:00.000Z",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "countless-sauna-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 2);
  assert.equal(progress.adherence.expectedSessionsByNow, null);
  assert.notEqual(progress.adherence.status, "not_started");
});

test("experiment progress treats partial calendar-less sessions as logged", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGC";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-partial-count-path",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug: "partial-count-path",
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-12",
          modality: "sauna",
          targetSessions: 2,
          minimumUsefulSessions: 1,
        },
        assistantSupport: {
          remindersEnabled: true,
          weeklyDigestEnabled: false,
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2GC",
        experimentId,
        experimentSlug: "partial-count-path",
        occurredAt: "2026-04-09T19:00:00.000Z",
        sessionStatus: "partial",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "partial-count-path", {
    asOf: "2026-04-10",
  });
  const outcome = analyzeExperimentOutcome(vault, "partial-count-path", {
    asOf: "2026-04-15",
  });

  assert.equal(progress.adherence.completedSessions, 0);
  assert.equal(progress.adherence.partialSessions, 1);
  assert.equal(progress.adherence.loggedSessions, 1);
  assert.notEqual(progress.adherence.status, "not_started");
  assert.notEqual(progress.recommendation.action, "remind");
  assert.deepEqual(outcome.confidence.reasons, [
    "Primary biomarker coverage is insufficient for a strong before-and-after read.",
  ]);
});

test("SAUNA assumed calendar sessions count as complete and explicit corrections override them", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1SANA";
  const experiment = makeExperiment("active", {
    experimentId,
    slug: "sauna-assumed-cadence",
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-05",
      interventionStart: "2026-04-06",
      interventionEnd: "2026-04-12",
      modality: "sauna",
      schedule: {
        kind: "cron",
        expression: "0 8 * * 1,3,5",
        timeZone: "America/New_York",
      },
      targetSessions: 3,
      minimumUsefulSessions: 2,
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-sauna-assumed",
    metadata: { timezone: "America/New_York" },
    entities: [experiment],
  });

  const progress = summarizeExperimentProgress(vault, "sauna-assumed-cadence", { asOf: "2026-04-12" });
  const calendar = collectExperimentAdherenceCalendar(vault, "sauna-assumed-cadence", { asOf: "2026-04-12" });
  const followup = decideExperimentFollowupDue(vault, "sauna-assumed-cadence", {
    kind: "missed-log",
    date: "2026-04-10",
  });
  const offPlanFollowup = decideExperimentFollowupDue(vault, "sauna-assumed-cadence", {
    kind: "missed-log",
    date: "2026-04-09",
  });

  assert.deepEqual(calendar?.cells.map((cell) => [cell.localDate, cell.status]), [
    ["2026-04-06", "assumed"],
    ["2026-04-08", "assumed"],
    ["2026-04-10", "assumed"],
  ]);
  assert.equal(progress.adherence.completedSessions, 3);
  assert.equal(progress.adherence.loggedSessions, 3);
  assert.equal(progress.adherence.expectedSessionsByNow, 3);
  assert.equal(progress.adherence.assumedSessions, 3);
  assert.equal(progress.adherence.status, "met_target");
  assert.equal(followup.action, "skip");
  assert.equal(followup.reason, "session_assumed");
  assert.equal(followup.window.sessionDate, "2026-04-10");
  assert.equal(offPlanFollowup.action, "skip");
  assert.equal(offPlanFollowup.reason, "unsupported_session_schedule");
  assert.equal(offPlanFollowup.window.sessionDate, null);

  const correctedVault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-sauna-assumed-corrected",
    metadata: { timezone: "America/New_York" },
    entities: [
      experiment,
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2SA",
        experimentId,
        experimentSlug: "sauna-assumed-cadence",
        occurredAt: "2026-04-08T12:00:00.000Z",
        sessionStatus: "skipped",
      }),
    ],
  });
  const correctedProgress = summarizeExperimentProgress(correctedVault, "sauna-assumed-cadence", {
    asOf: "2026-04-12",
  });
  const correctedCalendar = collectExperimentAdherenceCalendar(correctedVault, "sauna-assumed-cadence", {
    asOf: "2026-04-12",
  });

  assert.deepEqual(correctedCalendar?.cells.map((cell) => [cell.localDate, cell.status]), [
    ["2026-04-06", "assumed"],
    ["2026-04-08", "missed"],
    ["2026-04-10", "assumed"],
  ]);
  assert.equal(correctedProgress.adherence.completedSessions, 2);
  assert.equal(correctedProgress.adherence.loggedSessions, 2);
  assert.equal(correctedProgress.adherence.assumedSessions, 2);
});

test("TRETINOIN and red-light nightly schedules mix manual confirmations with assumptions", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1TRET";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-tretinoin-assumed",
    metadata: { timezone: "America/New_York" },
    entities: [
      makeExperiment("active", {
        experimentId,
        slug: "tretinoin-red-light-nightly",
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-10",
          modality: "tretinoin",
          schedule: {
            kind: "dailyLocal",
            localTime: "21:00",
            timeZone: "America/New_York",
          },
          targetSessions: 3,
          minimumUsefulSessions: 2,
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2TR",
        experimentId,
        experimentSlug: "tretinoin-red-light-nightly",
        occurredAt: "2026-04-09T22:00:00.000Z",
        source: "manual",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "tretinoin-red-light-nightly", { asOf: "2026-04-12" });
  const calendar = collectExperimentAdherenceCalendar(vault, "tretinoin-red-light-nightly", {
    asOf: "2026-04-12",
  });

  assert.deepEqual(calendar?.cells.map((cell) => [cell.localDate, cell.status]), [
    ["2026-04-08", "assumed"],
    ["2026-04-09", "satisfied"],
    ["2026-04-10", "assumed"],
  ]);
  assert.equal(progress.adherence.completedSessions, 3);
  assert.equal(progress.adherence.loggedSessions, 3);
  assert.equal(progress.adherence.assumedSessions, 2);
  assert.equal(progress.adherence.confirmedSessions, 1);
});

test("device running schedules keep missed-after-grace gaps and populate sensed sessions", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1DRNN";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-device-running-schedule",
    metadata: { timezone: "America/New_York" },
    entities: [
      makeExperiment("active", {
        experimentId,
        slug: "device-running-schedule",
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-10",
          modality: "Run",
          schedule: {
            kind: "dailyLocal",
            localTime: "07:00",
            timeZone: "America/New_York",
          },
          targetSessions: 3,
          minimumUsefulSessions: 2,
        },
      }),
      makeActivitySession({
        entityId: "evt_device_running_sensed",
        dayKey: "2026-04-09",
        activityType: "Running",
        provider: "whoop",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "device-running-schedule", { asOf: "2026-04-12" });
  const calendar = collectExperimentAdherenceCalendar(vault, "device-running-schedule", {
    asOf: "2026-04-12",
  });

  assert.deepEqual(calendar?.cells.map((cell) => [cell.localDate, cell.status]), [
    ["2026-04-08", "missed"],
    ["2026-04-09", "satisfied"],
    ["2026-04-10", "missed"],
  ]);
  assert.equal(progress.adherence.completedSessions, 1);
  assert.equal(progress.adherence.loggedSessions, 1);
  assert.equal(progress.adherence.sensedSessions, 1);
  assert.equal(progress.adherence.assumedSessions, undefined);
  assert.equal(progress.adherence.status, "behind");
});

test("cardio category experiments count running and swimming but not strength sessions", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-cardio-category-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId: "exp_01JNV4458HYPP53JDQCBP1CARD",
        slug: "cardio-category-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "cardio",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeActivitySession({
        entityId: "evt_cardio_run",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "device",
      }),
      makeActivitySession({
        entityId: "evt_cardio_swim",
        dayKey: "2026-06-03",
        activityType: "Swimming",
        source: "device",
      }),
      makeActivitySession({
        entityId: "evt_cardio_strength",
        dayKey: "2026-06-04",
        activityType: "Strength",
        source: "device",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "cardio-category-block", { asOf: "2026-06-09" });

  assert.deepEqual(progress.adherence.evidence, {
    eventKind: "activity_session",
    activityKind: "cardio",
  });
  assert.equal(progress.adherence.completedSessions, 2);
  assert.equal(progress.adherence.loggedSessions, 2);
  assert.equal(progress.adherence.sensedSessions, 2);
});

test("cardio category experiments reject explicitly contradictory intervention sessions only", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFC";
  const slug = "cardio-intervention-kind-scope";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-cardio-intervention-kind-scope",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug,
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-07",
          adherenceTargets: [{
            targetId: "cardio",
            label: "Cardio",
            phase: "intervention",
            calendar: {
              kind: "explicitDates",
              timeZone: "America/New_York",
              dates: [
                { localDate: "2026-06-01" },
                { localDate: "2026-06-02" },
                { localDate: "2026-06-03" },
              ],
            },
            evidence: {
              kind: "linkedEventCount",
              eventKind: "activity_session",
              activityKind: "cardio",
              missing: "missed_after_grace",
            },
            rollup: {
              targetCompletions: 3,
              minimumUsefulCompletions: 2,
            },
          }],
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE4AA",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId,
        experimentSlug: slug,
        interventionType: "strength",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE4AB",
        occurredAt: "2026-06-02T13:00:00.000Z",
        experimentId,
        experimentSlug: slug,
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE4AC",
        occurredAt: "2026-06-03T13:00:00.000Z",
        experimentId,
        experimentSlug: slug,
        interventionType: "running",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, slug, { asOf: "2026-06-05" });
  const calendar = collectExperimentAdherenceCalendar(vault, slug, { asOf: "2026-06-05" });

  assert.equal(progress.adherence.completedSessions, 2);
  assert.equal(progress.adherence.loggedSessions, 2);
  assert.deepEqual(calendar?.cells.map((cell) => [cell.localDate, cell.status, cell.evidenceIds]), [
    ["2026-06-01", "missed", []],
    ["2026-06-02", "satisfied", ["evt_01JNV45RHN0TQ9ZXE0A7YSE4AB"]],
    ["2026-06-03", "satisfied", ["evt_01JNV45RHN0TQ9ZXE0A7YSE4AC"]],
  ]);
});

test("experiment progress counts manual sessions for device-observable running adherence", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFN";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-running-manual-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug: "manual-run-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Run",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3AA",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId,
        experimentSlug: "manual-run-block",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3AB",
        occurredAt: "2026-06-03T13:00:00.000Z",
        experimentId,
        experimentSlug: "manual-run-block",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "manual-run-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 2);
});

test("experiment progress counts mixed manual and device sessions for running adherence", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFG";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-running-mixed-adherence",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug: "mixed-run-block",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-28",
          modality: "Run",
          targetSessions: 4,
          minimumUsefulSessions: 2,
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3AC",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId,
        experimentSlug: "mixed-run-block",
      }),
      makeActivitySession({ entityId: "evt_mixed_device_run_1", dayKey: "2026-06-03", activityType: "Running" }),
      makeActivitySession({ entityId: "evt_mixed_bike_1", dayKey: "2026-06-05", activityType: "Cycling" }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "mixed-run-block", { asOf: "2026-06-09" });

  assert.equal(progress.adherence.completedSessions, 2);
});

for (const scenario of [
  {
    name: "prefers a same-date sensed run over a manual missed-wearable run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGA",
    slug: "same-date-manual-device-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BA",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGA",
        experimentSlug: "same-date-manual-device-run",
      }),
      makeActivitySession({
        entityId: "evt_same_date_device_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
      }),
    ],
  },
  {
    name: "counts a surplus same-date done manual run beside one sensed run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGG",
    slug: "same-date-surplus-manual-device-run",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BF",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGG",
        experimentSlug: "same-date-surplus-manual-device-run",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BG",
        occurredAt: "2026-06-01T15:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGG",
        experimentSlug: "same-date-surplus-manual-device-run",
      }),
      makeActivitySession({
        entityId: "evt_same_date_surplus_device_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
      }),
    ],
  },
  {
    name: "lets two same-date sensed runs suppress two done manual rows",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGH",
    slug: "same-date-two-manual-two-device-runs",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BH",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGH",
        experimentSlug: "same-date-two-manual-two-device-runs",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BJ",
        occurredAt: "2026-06-01T15:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGH",
        experimentSlug: "same-date-two-manual-two-device-runs",
      }),
      makeActivitySession({
        entityId: "evt_same_date_pair_device_run_1a",
        dayKey: "2026-06-01",
        activityType: "Running",
      }),
      makeActivitySession({
        entityId: "evt_same_date_pair_device_run_1b",
        dayKey: "2026-06-01",
        activityType: "Run",
      }),
    ],
  },
  {
    name: "prefers a same-date device run over a manual activity run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGK",
    slug: "same-date-manual-activity-device-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      makeActivitySession({
        entityId: "evt_same_date_manual_activity_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "manual",
      }),
      makeActivitySession({
        entityId: "evt_same_date_device_activity_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "device",
      }),
    ],
  },
  {
    name: "counts a manual activity run when it is the only evidence",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGP",
    slug: "manual-activity-only-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      makeActivitySession({
        entityId: "evt_manual_activity_only_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "manual",
      }),
    ],
  },
  {
    name: "suppresses only one non-device done row for one same-date device run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGM",
    slug: "same-date-one-device-two-non-device-runs",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      makeActivitySession({
        entityId: "evt_one_device_two_non_device_manual_activity",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "manual",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BK",
        occurredAt: "2026-06-01T15:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGM",
        experimentSlug: "same-date-one-device-two-non-device-runs",
      }),
      makeActivitySession({
        entityId: "evt_one_device_two_non_device_device_activity",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "device",
      }),
    ],
  },
  {
    name: "counts different-date manual and sensed runs separately",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGB",
    slug: "different-date-manual-device-run",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BB",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGB",
        experimentSlug: "different-date-manual-device-run",
      }),
      makeActivitySession({
        entityId: "evt_different_date_device_run_1",
        dayKey: "2026-06-02",
        activityType: "Running",
      }),
    ],
  },
  {
    name: "counts two same-date sensed runs separately",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGC",
    slug: "same-date-two-device-runs",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      makeActivitySession({
        entityId: "evt_same_date_device_run_2a",
        dayKey: "2026-06-01",
        activityType: "Running",
      }),
      makeActivitySession({
        entityId: "evt_same_date_device_run_2b",
        dayKey: "2026-06-01",
        activityType: "Run",
      }),
    ],
  },
  {
    name: "keeps a manual-only missed-wearable run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGD",
    slug: "manual-only-device-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BC",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGD",
        experimentSlug: "manual-only-device-run",
      }),
    ],
  },
  {
    name: "leaves non-sensable manual sauna logs unchanged",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGE",
    slug: "manual-sauna-unchanged",
    modality: "sauna",
    expectedCompletedSessions: 1,
    events: [
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BD",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QJGE",
        experimentSlug: "manual-sauna-unchanged",
      }),
      makeActivitySession({
        entityId: "evt_manual_sauna_device_run_ignored",
        dayKey: "2026-06-01",
        activityType: "Running",
      }),
    ],
  },
] satisfies Array<{
  events: CanonicalEntity[];
  expectedCompletedSessions: number;
  experimentId: string;
  modality: string;
  name: string;
  slug: string;
}>) {
  test(`experiment progress ${scenario.name}`, () => {
    const vault = createVaultReadModel({
      vaultRoot: `/virtual/experiment-analysis-${scenario.slug}`,
      metadata: null,
      entities: [
        makeExperiment("active", {
          experimentId: scenario.experimentId,
          slug: scenario.slug,
          runPlan: {
            baselineStart: "2026-05-25",
            baselineEnd: "2026-05-31",
            interventionStart: "2026-06-01",
            interventionEnd: "2026-06-28",
            modality: scenario.modality,
            targetSessions: 4,
            minimumUsefulSessions: 1,
          },
        }),
        ...scenario.events,
      ],
    });

    const progress = summarizeExperimentProgress(vault, scenario.slug, { asOf: "2026-06-09" });
    assert.equal(progress.adherence.completedSessions, scenario.expectedCompletedSessions);
  });
}

test("experiment adherence counts keep same-date missed manual annotations when a sensed run matches", () => {
  const target = {
    targetId: "run-target",
    label: "Run",
    phase: "intervention",
    evidence: {
      kind: "linkedEventCount",
      eventKind: "activity_session",
      activityKind: "running",
      missing: "missed_after_grace",
    },
  } satisfies ExperimentAdherenceTarget;

  const counts = countCompletedAdherenceSessions({
    asOfDate: "2026-06-01",
    observations: [
      {
        evidenceId: "evt_missed_manual_annotation",
        eventKind: "intervention_session",
        localDate: "2026-06-01",
        status: "missed",
        targetId: "run-target",
      },
      {
        activityKind: "Running",
        evidenceId: "evt_missed_annotation_device_run",
        eventKind: "activity_session",
        localDate: "2026-06-01",
        targetId: "run-target",
      },
    ],
    target,
    windows: {
      baselineEnd: null,
      baselineStart: null,
      interventionEnd: "2026-06-01",
      interventionStart: "2026-06-01",
    },
  });

  assert.equal(counts.completedSessions, 1);
  assert.equal(counts.missedSessions, 1);
});

test("experiment adherence calendar suppresses same-date manual fallback when a sensed run matches", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGF";
  const slug = "calendar-same-date-manual-device-run";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-calendar-same-date-manual-device-run",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug,
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-01",
          modality: "Run",
          targetSessions: 1,
          minimumUsefulSessions: 1,
          schedule: {
            kind: "dailyLocal",
            localTime: "08:00",
            timeZone: "America/New_York",
          },
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BE",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId,
        experimentSlug: slug,
      }),
      makeActivitySession({
        entityId: "evt_calendar_same_date_device_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
      }),
    ],
  });

  const calendar = collectExperimentAdherenceCalendar(vault, slug, { asOf: "2026-06-03" });

  assert.equal(calendar?.cells[0]?.status, "satisfied");
  assert.equal(calendar?.cells[0]?.observedCount, 1);
  assert.deepEqual(calendar?.cells[0]?.evidenceIds, ["evt_calendar_same_date_device_run_1"]);
});

test("experiment adherence calendar suppresses same-date manual activity when a device run matches", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGN";
  const slug = "calendar-same-date-manual-activity-device-run";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-calendar-same-date-manual-activity-device-run",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug,
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-01",
          modality: "Run",
          targetSessions: 1,
          minimumUsefulSessions: 1,
          schedule: {
            kind: "dailyLocal",
            localTime: "08:00",
            timeZone: "America/New_York",
          },
        },
      }),
      makeActivitySession({
        entityId: "evt_calendar_same_date_manual_activity_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "manual",
      }),
      makeActivitySession({
        entityId: "evt_calendar_same_date_device_activity_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
        source: "device",
      }),
    ],
  });

  const calendar = collectExperimentAdherenceCalendar(vault, slug, { asOf: "2026-06-03" });

  assert.equal(calendar?.cells[0]?.status, "satisfied");
  assert.equal(calendar?.cells[0]?.observedCount, 1);
  assert.deepEqual(calendar?.cells[0]?.evidenceIds, ["evt_calendar_same_date_device_activity_run_1"]);
});

test("experiment adherence calendar keeps surplus same-date manual evidence after one sensed run", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJGJ";
  const slug = "calendar-same-date-surplus-manual-device-run";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-calendar-same-date-surplus-manual-device-run",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug,
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-01",
          modality: "Run",
          targetSessions: 1,
          minimumUsefulSessions: 1,
          schedule: {
            kind: "dailyLocal",
            localTime: "08:00",
            timeZone: "America/New_York",
          },
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BK",
        occurredAt: "2026-06-01T13:00:00.000Z",
        experimentId,
        experimentSlug: slug,
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BM",
        occurredAt: "2026-06-01T15:00:00.000Z",
        experimentId,
        experimentSlug: slug,
      }),
      makeActivitySession({
        entityId: "evt_calendar_surplus_device_run_1",
        dayKey: "2026-06-01",
        activityType: "Running",
      }),
    ],
  });

  const calendar = collectExperimentAdherenceCalendar(vault, slug, { asOf: "2026-06-03" });

  assert.equal(calendar?.cells[0]?.status, "satisfied");
  assert.equal(calendar?.cells[0]?.observedCount, 2);
  assert.deepEqual(calendar?.cells[0]?.evidenceIds, [
    "evt_01JNV45RHN0TQ9ZXE0A7YSE3BM",
    "evt_calendar_surplus_device_run_1",
  ]);
});

test("experiment progress uses canonical activity date for scheduled running adherence", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFH";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-running-date-boundary",
    metadata: null,
    entities: [
      makeExperiment("active", {
        experimentId,
        slug: "run-date-boundary",
        runPlan: {
          baselineStart: "2026-05-25",
          baselineEnd: "2026-05-31",
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-07",
          modality: "Run",
          targetSessions: 7,
          minimumUsefulSessions: 1,
          schedule: {
            kind: "dailyLocal",
            localTime: "08:00",
            timeZone: "America/New_York",
          },
        },
      }),
      makeActivitySession({
        entityId: "evt_run_boundary_1",
        dayKey: "2026-06-01",
        occurredAt: "2026-06-01T01:30:00.000Z",
        activityType: "Run",
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "run-date-boundary", { asOf: "2026-06-02" });

  assert.equal(progress.adherence.completedSessions, 1);
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
    activityProviders: [],
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

test("experiment analysis rejects unitless test-result anchors with stale canonical values", () => {
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
          kind: "lab_panel",
          recordId: "evt_glucose_unitless_stale_baseline",
          biomarkerKeys: ["biomarker:blood-glucose"],
          observedOn: "2026-06-01",
        },
        {
          role: "followup",
          kind: "lab_panel",
          recordId: "evt_glucose_unitful_followup",
          biomarkerKeys: ["biomarker:blood-glucose"],
          observedOn: "2026-06-02",
        },
      ],
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-analysis-unitless-stale-anchors",
    metadata: null,
    entities: [experiment],
  });

  const outcome = analyzeExperimentOutcome(vault, "glucose-uncanonicalized-anchors", {
    asOf: "2026-06-02",
    metricPoints: [
      makeProjectedMetricPoint({
        biomarkerKey: "biomarker:blood-glucose",
        canonicalUnit: "mg/dL",
        canonicalValue: 100,
        date: "2026-06-01",
        metricKey: "glucose",
        sourceKind: "test-result",
        sourceLabel: "Lab",
        sourceRecordId: "evt_glucose_unitless_stale_baseline",
        unit: null,
        value: 100,
      }),
      makeProjectedMetricPoint({
        biomarkerKey: "biomarker:blood-glucose",
        date: "2026-06-02",
        metricKey: "glucose",
        sourceKind: "test-result",
        sourceLabel: "Lab",
        sourceRecordId: "evt_glucose_unitful_followup",
        unit: "mg/dL",
        value: 90,
      }),
    ],
  });

  assert.equal(outcome.metricResults[0]?.baselineMean, null);
  assert.equal(outcome.metricResults[0]?.interventionMean, 90);
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
  assert.equal(progress.adherence.evidence, undefined);
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
  assert.equal(progress.adherence.evidence, undefined);
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

test("experiment outcome demotes confidence when most sessions are assumed", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1ASMD";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-outcome-assumed-majority",
    metadata: { timezone: "America/New_York" },
    entities: [
      makeExperiment("completed", {
        experimentId,
        slug: "assumed-majority-outcome",
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-03",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-10",
          modality: "sauna",
          schedule: {
            kind: "dailyLocal",
            localTime: "08:00",
            timeZone: "America/New_York",
          },
          targetSessions: 3,
          minimumUsefulSessions: 1,
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2A1",
        experimentId,
        experimentSlug: "assumed-majority-outcome",
        occurredAt: "2026-04-08T12:00:00.000Z",
        source: "manual",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2A2",
        experimentId,
        experimentSlug: "assumed-majority-outcome",
        occurredAt: "2026-04-08T14:00:00.000Z",
        source: "manual",
      }),
      makeObservation({
        entityId: "evt_assumed_metric_base_1",
        dayKey: "2026-04-01",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-01T06:00:00.000Z",
        unit: "bpm",
        value: 62,
      }),
      makeObservation({
        entityId: "evt_assumed_metric_base_2",
        dayKey: "2026-04-02",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-02T06:00:00.000Z",
        unit: "bpm",
        value: 61,
      }),
      makeObservation({
        entityId: "evt_assumed_metric_base_3",
        dayKey: "2026-04-03",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-03T06:00:00.000Z",
        unit: "bpm",
        value: 62,
      }),
      makeObservation({
        entityId: "evt_assumed_metric_intervention_1",
        dayKey: "2026-04-08",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-08T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
      makeObservation({
        entityId: "evt_assumed_metric_intervention_2",
        dayKey: "2026-04-09",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-09T06:00:00.000Z",
        unit: "bpm",
        value: 58,
      }),
      makeObservation({
        entityId: "evt_assumed_metric_intervention_3",
        dayKey: "2026-04-10",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-10T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "assumed-majority-outcome", { asOf: "2026-04-12" });
  const outcome = analyzeExperimentOutcome(vault, "assumed-majority-outcome", { asOf: "2026-04-12" });

  assert.equal(progress.adherence.completedSessions, 3);
  assert.equal(progress.adherence.confirmedSessions, 1);
  assert.equal(progress.adherence.assumedSessions, 2);
  assert.equal(outcome.confidence.level, "medium");
  assert.deepEqual(outcome.confidence.reasons, [
    "Most sessions are assumed rather than confirmed.",
  ]);
});

test("experiment outcome keeps confidence high when confirmed sessions are the majority", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1CNFR";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-outcome-confirmed-majority",
    metadata: { timezone: "America/New_York" },
    entities: [
      makeExperiment("completed", {
        experimentId,
        slug: "confirmed-majority-outcome",
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-03",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-10",
          modality: "sauna",
          schedule: {
            kind: "dailyLocal",
            localTime: "08:00",
            timeZone: "America/New_York",
          },
          targetSessions: 3,
          minimumUsefulSessions: 1,
        },
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2C1",
        experimentId,
        experimentSlug: "confirmed-majority-outcome",
        occurredAt: "2026-04-08T12:00:00.000Z",
        source: "manual",
      }),
      makeSession({
        entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE2C2",
        experimentId,
        experimentSlug: "confirmed-majority-outcome",
        occurredAt: "2026-04-09T12:00:00.000Z",
        source: "manual",
      }),
      makeObservation({
        entityId: "evt_confirmed_metric_base_1",
        dayKey: "2026-04-01",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-01T06:00:00.000Z",
        unit: "bpm",
        value: 62,
      }),
      makeObservation({
        entityId: "evt_confirmed_metric_base_2",
        dayKey: "2026-04-02",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-02T06:00:00.000Z",
        unit: "bpm",
        value: 61,
      }),
      makeObservation({
        entityId: "evt_confirmed_metric_base_3",
        dayKey: "2026-04-03",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-03T06:00:00.000Z",
        unit: "bpm",
        value: 62,
      }),
      makeObservation({
        entityId: "evt_confirmed_metric_intervention_1",
        dayKey: "2026-04-08",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-08T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
      makeObservation({
        entityId: "evt_confirmed_metric_intervention_2",
        dayKey: "2026-04-09",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-09T06:00:00.000Z",
        unit: "bpm",
        value: 58,
      }),
      makeObservation({
        entityId: "evt_confirmed_metric_intervention_3",
        dayKey: "2026-04-10",
        metric: "resting-heart-rate",
        occurredAt: "2026-04-10T06:00:00.000Z",
        unit: "bpm",
        value: 59,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, "confirmed-majority-outcome", { asOf: "2026-04-12" });
  const outcome = analyzeExperimentOutcome(vault, "confirmed-majority-outcome", { asOf: "2026-04-12" });

  assert.equal(progress.adherence.assumedSessions, 1);
  assert.equal(progress.adherence.confirmedSessions, 2);
  assert.equal(outcome.confidence.level, "high");
  assert.deepEqual(outcome.confidence.reasons, []);
});

test("experiment outcome stays deterministic and expresses uncertainty through confidence reasons", () => {
  const outcome = analyzeExperimentOutcome(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-25",
  });
  const repeatedOutcome = analyzeExperimentOutcome(createExperimentVault(), "sauna-rhr", {
    asOf: "2026-04-25",
  });

  assert.equal(outcome.schema, "murph.experiment-outcome.v2");
  assert.equal(outcome.schemaVersion, "murph.experiment-outcome.v2");
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
    points: [
      {
        date: "2026-04-01",
        phase: "baseline",
        unit: "bpm",
        value: 62,
      },
      {
        date: "2026-04-02",
        phase: "baseline",
        unit: "bpm",
        value: 61,
      },
      {
        date: "2026-04-03",
        phase: "baseline",
        unit: "bpm",
        value: 61,
      },
      {
        date: "2026-04-08",
        phase: "intervention",
        unit: "bpm",
        value: 59,
      },
      {
        date: "2026-04-09",
        phase: "intervention",
        unit: "bpm",
        value: 58,
      },
      {
        date: "2026-04-10",
        phase: "intervention",
        unit: "bpm",
        value: 59,
      },
    ],
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
      "Logged session count stayed below the minimum useful target.",
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
    evidence: { eventKind: "intervention_session" },
    expectedSessionsByNow: 2,
    loggedSessions: 1,
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

test("experiment follow-up due keeps calendar-less count targets on main missed-log behavior", () => {
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

test("experiment follow-up due skips assumed calendar missed-log dates only after due gates pass", () => {
  const experiment = makeExperiment("active", {
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-07",
      interventionStart: "2026-04-08",
      interventionEnd: "2026-04-21",
      modality: "sauna",
      schedule: {
        kind: "dailyLocal",
        localTime: "08:00",
        timeZone: "America/New_York",
      },
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
    vaultRoot: "/virtual/experiment-followup-due-assumed-calendar",
    metadata: { timezone: "America/New_York" },
    entities: [experiment],
  });

  const earlyDecision = decideExperimentFollowupDue(vault, "sauna-rhr", {
    kind: "missed-log",
    date: "2026-04-07",
  });
  const dueDecision = decideExperimentFollowupDue(vault, "sauna-rhr", {
    kind: "missed-log",
    date: "2026-04-10",
  });

  assert.equal(earlyDecision.action, "skip");
  assert.equal(earlyDecision.reason, "not_in_intervention_window");
  assert.equal(earlyDecision.window.sessionDate, null);
  assert.equal(dueDecision.action, "skip");
  assert.equal(dueDecision.reason, "session_assumed");
  assert.equal(dueDecision.window.sessionDate, "2026-04-10");
});

test("legacy repeated assumed targets are missed and retain missed-log follow-up", () => {
  const slug = "legacy-repeated-assumed-followup";
  const experiment = makeExperiment("active", {
    slug,
    runPlan: {
      interventionStart: "2026-04-10",
      interventionEnd: "2026-04-10",
      modality: "Micro set",
      schedule: {
        kind: "dailyLocal",
        localTime: "08:00",
        timeZone: "America/New_York",
      },
      targetSessions: 8,
      minimumUsefulSessions: 6,
      adherenceTargets: [{
        targetId: "micro-set",
        label: "Micro set",
        phase: "intervention",
        calendar: {
          kind: "daily",
          timeZone: "America/New_York",
          localTime: "08:00",
          targetCountPerDay: 8,
        },
        evidence: {
          kind: "linkedEventCount",
          eventKind: "intervention_session",
          missing: "assumed_after_grace",
        },
      }],
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/legacy-repeated-assumed-followup",
    metadata: { timezone: "America/New_York" },
    entities: [experiment],
  });

  const progress = summarizeExperimentProgress(vault, slug, {
    asOf: "2026-04-12",
  });
  const decision = decideExperimentFollowupDue(vault, slug, {
    kind: "missed-log",
    date: "2026-04-10",
  });

  assert.equal(progress.adherence.assumedSessions ?? 0, 0);
  assert.equal(progress.adherence.completedSessions, 0);
  assert.equal(progress.adherence.expectedSessionsByNow, 8);
  assert.equal(decision.action, "notify");
  assert.equal(decision.reason, "planned_session_log_missing");
});

test("experiment follow-up due assumes only dates where all planned calendar targets are assumed", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1MXTG",
    slug: "mixed-calendar-targets",
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-07",
      interventionStart: "2026-04-08",
      interventionEnd: "2026-04-12",
      targetSessions: 5,
      minimumUsefulSessions: 3,
      adherenceTargets: [
        {
          targetId: "sauna",
          label: "Sauna",
          phase: "intervention",
          calendar: {
            kind: "explicitDates",
            timeZone: "America/New_York",
            dates: [
              { localDate: "2026-04-10" },
              { localDate: "2026-04-11" },
            ],
          },
          evidence: {
            kind: "linkedEventCount",
            eventKind: "intervention_session",
            missing: "assumed_after_grace",
          },
        },
        {
          targetId: "manual-session",
          label: "Manual session",
          phase: "intervention",
          calendar: {
            kind: "explicitDates",
            timeZone: "America/New_York",
            dates: [
              { localDate: "2026-04-10" },
            ],
          },
          evidence: {
            kind: "linkedEventCount",
            eventKind: "intervention_session",
            missing: "missed_after_grace",
          },
        },
      ],
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-mixed-calendar-targets",
    metadata: { timezone: "America/New_York" },
    entities: [experiment],
  });

  const sharedDateDecision = decideExperimentFollowupDue(vault, "mixed-calendar-targets", {
    kind: "missed-log",
    date: "2026-04-10",
  });
  const assumedOnlyDateDecision = decideExperimentFollowupDue(vault, "mixed-calendar-targets", {
    kind: "missed-log",
    date: "2026-04-11",
  });

  assert.equal(sharedDateDecision.action, "notify");
  assert.equal(sharedDateDecision.reason, "planned_session_log_missing");
  assert.equal(sharedDateDecision.window.sessionDate, "2026-04-10");
  assert.equal(assumedOnlyDateDecision.action, "skip");
  assert.equal(assumedOnlyDateDecision.reason, "session_assumed");
  assert.equal(assumedOnlyDateDecision.window.sessionDate, "2026-04-11");
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

test("experiment follow-up due honors sessionLocalDate for later-recorded corrections", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFD",
    slug: "late-session-local-date",
    runPlan: {
      baselineStart: "2026-04-01",
      baselineEnd: "2026-04-07",
      interventionStart: "2026-04-08",
      interventionEnd: "2026-04-21",
      modality: "sauna",
      schedule: {
        kind: "dailyLocal",
        localTime: "08:00",
        timeZone: "America/New_York",
      },
      targetSessions: 14,
      minimumUsefulSessions: 10,
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const skippedCorrection = makeSession({
    entityId: "evt_01JNV45RHN0TQ9ZXE0A7YSE4AD",
    occurredAt: "2026-04-12T19:00:00.000Z",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFD",
    experimentSlug: "late-session-local-date",
    sessionLocalDate: "2026-04-10",
    sessionStatus: "skipped",
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-session-local-date",
    metadata: { timezone: "America/New_York" },
    entities: [experiment, skippedCorrection],
  });

  const progress = summarizeExperimentProgress(vault, "late-session-local-date", {
    asOf: "2026-04-11",
  });
  const calendar = collectExperimentAdherenceCalendar(vault, "late-session-local-date", {
    asOf: "2026-04-11",
  });
  const decision = decideExperimentFollowupDue(vault, "late-session-local-date", {
    kind: "missed-log",
    date: "2026-04-10",
  });

  assert.equal(progress.adherence.completedSessions, 2);
  const cellsByDate = new Map(calendar?.cells.map((cell) => [cell.localDate, cell.status]));
  assert.equal(cellsByDate.get("2026-04-08"), "assumed");
  assert.equal(cellsByDate.get("2026-04-09"), "assumed");
  assert.equal(cellsByDate.get("2026-04-10"), "missed");
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "session_already_logged");
  assert.equal(decision.window.sessionDate, "2026-04-10");
});

test("experiment follow-up due skips missed-log when device activity already handled a run date", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFK",
    slug: "daily-run",
    runPlan: {
      baselineStart: "2026-05-25",
      baselineEnd: "2026-05-31",
      interventionStart: "2026-06-01",
      interventionEnd: "2026-06-14",
      modality: "Run",
      sessionsPerWeek: 7,
      targetSessions: 14,
      minimumUsefulSessions: 10,
      schedule: {
        kind: "dailyLocal",
        localTime: "08:00",
        timeZone: "America/New_York",
      },
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-device-activity",
    metadata: { timezone: "America/New_York" },
    entities: [
      experiment,
      makeActivitySession({
        entityId: "evt_daily_run_device_1",
        dayKey: "2026-06-03",
        occurredAt: "2026-06-03T22:00:00.000Z",
        activityType: "Running",
      }),
    ],
  });

  const decision = decideExperimentFollowupDue(vault, "daily-run", {
    kind: "missed-log",
    date: "2026-06-03",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "session_already_logged");
});

test("experiment follow-up due uses explicit activity target evidence for missed-log checks", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFQ",
    slug: "daily-explicit-run",
    runPlan: {
      baselineStart: "2026-05-25",
      baselineEnd: "2026-05-31",
      interventionStart: "2026-06-01",
      interventionEnd: "2026-06-14",
      modality: "Workout",
      targetSessions: 14,
      minimumUsefulSessions: 10,
      adherenceTargets: [{
        targetId: "running",
        label: "Running",
        phase: "intervention",
        evidence: {
          kind: "linkedEventCount",
          eventKind: "activity_session",
          activityKind: "running",
          missing: "missed_after_grace",
        },
        rollup: {
          targetCompletions: 14,
          minimumUsefulCompletions: 10,
        },
      }],
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-explicit-device-activity",
    metadata: { timezone: "America/New_York" },
    entities: [
      experiment,
      makeActivitySession({
        entityId: "evt_explicit_daily_run_device_1",
        dayKey: "2026-06-03",
        occurredAt: "2026-06-03T22:00:00.000Z",
        activityType: "Run",
      }),
    ],
  });

  const decision = decideExperimentFollowupDue(vault, "daily-explicit-run", {
    kind: "missed-log",
    date: "2026-06-03",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "session_already_logged");
});

test("experiment follow-up due skips missed-log when generic activity target has any device activity", () => {
  const experiment = makeExperiment("active", {
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFR",
    slug: "daily-any-activity",
    runPlan: {
      baselineStart: "2026-05-25",
      baselineEnd: "2026-05-31",
      interventionStart: "2026-06-01",
      interventionEnd: "2026-06-14",
      modality: "Workout",
      targetSessions: 14,
      minimumUsefulSessions: 10,
      adherenceTargets: [{
        targetId: "any-activity",
        label: "Any activity",
        phase: "intervention",
        calendar: {
          kind: "daily",
          timeZone: "America/New_York",
        },
        evidence: {
          kind: "linkedEventCount",
          eventKind: "activity_session",
          missing: "missed_after_grace",
        },
        rollup: {
          targetCompletions: 14,
          minimumUsefulCompletions: 10,
        },
      }],
    },
    assistantSupport: {
      remindersEnabled: true,
      missedLogFollowup: "default_on",
      weeklyDigestEnabled: false,
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-generic-device-activity",
    metadata: { timezone: "America/New_York" },
    entities: [
      experiment,
      makeActivitySession({
        entityId: "evt_generic_daily_activity_device_1",
        dayKey: "2026-06-03",
        occurredAt: "2026-06-03T22:00:00.000Z",
        activityType: "Cycling",
      }),
    ],
  });

  const decision = decideExperimentFollowupDue(vault, "daily-any-activity", {
    kind: "missed-log",
    date: "2026-06-03",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "session_already_logged");
});

test("experiment missed-log follow-up matches canonical multi-activity adherence", () => {
  const cases = [
    {
      activityType: "Walking",
      durationMinutes: 40,
      qualifies: true,
      suffix: "walk",
    },
    {
      activityType: "Rowing",
      durationMinutes: 35,
      qualifies: true,
      suffix: "row",
    },
    {
      activityType: "Cycling",
      durationMinutes: 20,
      qualifies: false,
      suffix: "short-cycle",
    },
    {
      activityType: "Running",
      durationMinutes: 50,
      qualifies: false,
      suffix: "run",
    },
    {
      activityType: "Elliptical",
      qualifies: true,
      suffix: "unknown-duration",
    },
    {
      activityType: "Strength",
      durationMinutes: 50,
      qualifies: false,
      suffix: "strength",
    },
  ] as const;

  for (const [index, scenario] of cases.entries()) {
    const slug = `daily-zone-2-${scenario.suffix}`;
    const experiment = makeExperiment("active", {
      experimentId: "exp_01JNV4458HYPP53JDQCBP1QJZ2",
      slug,
      commonsProtocolRef: {
        key: "protocol_variant:aerobic-base-training/zone-2-aerobic-base-block",
        pageRevisionId: "sha256:page-revision",
        runSpecRevisionId: "sha256:run-spec-revision",
        testPlanId: "zone2-aerobic-base-readout",
      },
      effectiveProtocolSnapshot: {
        effectiveSpecHash: `sha256:${"4".repeat(64)}`,
        doseSignature: "Daily easy cardio, at least 35 min",
        modality: "sustainable easy aerobic volume",
        activitySessionEvidence: {
          activityKinds: ["walking", "cycling", "rowing", "elliptical"],
          minimumDurationMinutes: 35,
        },
        targetSessions: 14,
        minimumUsefulSessions: 10,
      },
      runPlan: {
        baselineStart: "2026-05-25",
        baselineEnd: "2026-05-31",
        interventionStart: "2026-06-01",
        interventionEnd: "2026-06-14",
        modality: "Cycling",
        sessionsPerWeek: 7,
        targetSessions: 14,
        minimumUsefulSessions: 10,
        schedule: {
          kind: "dailyLocal",
          localTime: "08:00",
          timeZone: "America/New_York",
        },
      },
      assistantSupport: {
        remindersEnabled: true,
        missedLogFollowup: "default_on",
        weeklyDigestEnabled: false,
      },
    });
    const activity = makeActivitySession({
      entityId: `evt_daily_zone_2_${index}`,
      dayKey: "2026-06-03",
      occurredAt: "2026-06-03T22:00:00.000Z",
      activityType: scenario.activityType,
      ...("durationMinutes" in scenario
        ? { durationMinutes: scenario.durationMinutes }
        : {}),
    });
    const vault = createVaultReadModel({
      vaultRoot: `/virtual/experiment-followup-${scenario.suffix}`,
      metadata: { timezone: "America/New_York" },
      entities: [experiment, activity],
    });

    const progress = summarizeExperimentProgress(vault, slug, {
      asOf: "2026-06-03",
    });
    const decision = decideExperimentFollowupDue(vault, slug, {
      kind: "missed-log",
      date: "2026-06-03",
    });

    assert.equal(
      progress.adherence.completedSessions,
      scenario.qualifies ? 1 : 0,
      `${scenario.suffix} progress qualification`,
    );
    assert.equal(
      decision.action,
      scenario.qualifies ? "skip" : "notify",
      `${scenario.suffix} follow-up action`,
    );
    assert.equal(
      decision.reason,
      scenario.qualifies
        ? "session_already_logged"
        : "planned_session_log_missing",
      `${scenario.suffix} follow-up reason`,
    );
  }
});

test("experiment follow-up due skips missed-log for opt-out and unsupported non-daily schedules", () => {
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
  const nonDailySaunaCountTarget = createVaultReadModel({
    vaultRoot: "/virtual/experiment-followup-nondaily-sauna-count",
    metadata: null,
    entities: [
      makeExperiment("active", {
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-07",
          interventionStart: "2026-04-08",
          interventionEnd: "2026-04-21",
          modality: "sauna",
          sessionsPerWeek: 3,
          targetSessions: 4,
          minimumUsefulSessions: 3,
        },
        assistantSupport: {
          remindersEnabled: true,
          missedLogFollowup: "default_on",
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
  const saunaCountDecision = decideExperimentFollowupDue(nonDailySaunaCountTarget, "sauna-rhr", {
    kind: "missed-log",
    date: "2026-04-10",
  });
  assert.equal(saunaCountDecision.action, "skip");
  assert.equal(saunaCountDecision.reason, "unsupported_session_schedule");
  assert.equal(saunaCountDecision.window.sessionDate, null);
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
