import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import {
  analyzeExperimentOutcome,
  createVaultReadModel,
  summarizeExperimentProgress,
  type MetricPoint,
} from "../src/index.ts";

function makeExperiment(input: {
  analysisPlan: Record<string, unknown>;
  runPlan: Record<string, unknown>;
  slug: string;
  status?: "active" | "completed";
}): CanonicalEntity {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJZZ";
  const startedOn = "2026-04-01";
  return {
    entityId: experimentId,
    primaryLookupId: experimentId,
    lookupIds: [experimentId, input.slug],
    family: "experiment",
    recordClass: "bank",
    kind: "experiment_entry",
    status: input.status ?? "active",
    occurredAt: `${startedOn}T08:00:00.000Z`,
    date: startedOn,
    path: `experiments/${input.slug}.md`,
    title: "Open-ended experiment",
    body: null,
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId,
      slug: input.slug,
      status: input.status ?? "active",
      title: "Open-ended experiment",
      startedOn,
      runPlan: input.runPlan,
      analysisPlan: input.analysisPlan,
    },
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: input.slug,
    tags: [],
  };
}

function metricPoint(input: {
  biomarkerKey?: string;
  date: string;
  metricKey?: string;
  observedAt?: string;
  recordId: string;
  unit?: string;
  value: number;
}): MetricPoint {
  const metricKey = input.metricKey ?? "repetition-capacity";
  const unit = input.unit ?? "repetitions";
  return {
    schemaVersion: "murph.metric-point.v1",
    biomarkerKey: input.biomarkerKey ?? `biomarker:${metricKey}`,
    canonicalUnit: unit,
    canonicalValue: input.value,
    comparator: null,
    confidence: "high",
    context: {
      contributingRecordIds: [input.recordId],
      syntheticRecordId: input.recordId,
    },
    effectiveDate: input.date,
    grain: "day",
    id: `metric-point:${input.recordId}`,
    metricKey,
    observedAt: input.observedAt ?? `${input.date}T12:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Manual measurement",
    },
    recordedAt: `${input.date}T12:00:00.000Z`,
    reportedAt: null,
    source: {
      family: "event",
      kind: "measurement",
      path: `history/events/${input.recordId}.json`,
      recordId: input.recordId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value: input.value,
  };
}

function sessionEntity(input: {
  date: string;
  experimentId: string;
  fieldId: string;
  recordId: string;
  slug: string;
  value: number;
}): CanonicalEntity {
  return {
    entityId: input.recordId,
    primaryLookupId: input.recordId,
    lookupIds: [input.recordId],
    family: "event",
    recordClass: "ledger",
    kind: "intervention_session",
    status: null,
    occurredAt: `${input.date}T08:00:00.000Z`,
    date: input.date,
    path: `history/events/${input.recordId}.json`,
    title: "Experiment session",
    body: null,
    attributes: {
      experimentId: input.experimentId,
      experimentSlug: input.slug,
      fields: { [input.fieldId]: input.value },
      sessionLocalDate: input.date,
      sessionStatus: "completed",
    },
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: input.slug,
    tags: [],
  };
}

function evidenceEntity(input: {
  date: string;
  kind: "document" | "photo" | "text";
  recordId: string;
  slug: string;
}): CanonicalEntity {
  return {
    entityId: input.recordId,
    primaryLookupId: input.recordId,
    lookupIds: [input.recordId],
    family: "event",
    recordClass: "ledger",
    kind: input.kind,
    status: null,
    occurredAt: `${input.date}T12:00:00.000Z`,
    date: input.date,
    path: `history/events/${input.recordId}.json`,
    title: "Structured review evidence",
    body: null,
    attributes: {
      experimentSlug: input.slug,
    },
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: input.slug,
    tags: [],
  };
}

test("custom numeric experiment outcomes use the declared reducer without catalog enrollment", () => {
  const slug = "repetition-benchmark";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-repetition-benchmark",
    metadata: { timezone: "UTC" },
    entities: [makeExperiment({
      slug,
      runPlan: {
        baselineStart: "2026-04-01",
        baselineEnd: "2026-04-03",
        interventionStart: "2026-04-04",
        interventionEnd: "2026-04-06",
        modality: "movement practice",
      },
      analysisPlan: {
        primaryOutcome: {
          kind: "metric",
          key: "biomarker:repetition-capacity",
          label: "Repetition capacity",
          statistic: "latest",
        },
        desiredDirection: "increase",
      },
    })],
  });
  const metricPoints = [
    metricPoint({ date: "2026-04-01", recordId: "evt_benchmark_baseline_1", value: 10 }),
    metricPoint({ date: "2026-04-03", recordId: "evt_benchmark_baseline_2", value: 12 }),
    metricPoint({ date: "2026-04-04", recordId: "evt_benchmark_followup_1", value: 14 }),
    metricPoint({ date: "2026-04-06", recordId: "evt_benchmark_followup_2", value: 15 }),
  ];

  const progress = summarizeExperimentProgress(vault, slug, {
    asOf: "2026-04-06",
    metricPoints,
  });
  const outcome = analyzeExperimentOutcome(vault, slug, {
    asOf: "2026-04-06",
    metricPoints,
  });

  assert.deepEqual(progress.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.equal(progress.signals[0]?.label, "Repetition capacity");
  assert.equal(progress.signals[0]?.baselineMean, 12);
  assert.equal(progress.signals[0]?.interventionMean, 15);
  assert.equal(progress.signals[0]?.deltaAbs, 3);
  assert.equal(progress.signals[0]?.statistic, "latest");
  assert.notEqual(progress.dataCoverage.status, "no_wearable_data");
  assert.equal(outcome.metricResults[0]?.baselineMean, 12);
  assert.equal(outcome.metricResults[0]?.interventionMean, 15);
  assert.equal(outcome.metricResults[0]?.deltaPct, 25);
});

test("custom max outcomes reduce multiple attempts on the same day", () => {
  const slug = "same-day-maximum";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-same-day-maximum",
    metadata: { timezone: "UTC" },
    entities: [makeExperiment({
      slug,
      runPlan: {
        baselineStart: "2026-04-01",
        baselineEnd: "2026-04-01",
        interventionStart: "2026-04-02",
        interventionEnd: "2026-04-02",
        modality: "movement practice",
      },
      analysisPlan: {
        primaryOutcome: {
          kind: "metric",
          key: "biomarker:repetition-capacity",
          statistic: "max",
        },
      },
    })],
  });
  const metricPoints = [
    metricPoint({
      date: "2026-04-01",
      observedAt: "2026-04-01T08:00:00.000Z",
      recordId: "evt_benchmark_baseline_attempt_1",
      value: 8,
    }),
    metricPoint({
      date: "2026-04-01",
      observedAt: "2026-04-01T09:00:00.000Z",
      recordId: "evt_benchmark_baseline_attempt_2",
      value: 10,
    }),
    metricPoint({
      date: "2026-04-02",
      observedAt: "2026-04-02T08:00:00.000Z",
      recordId: "evt_benchmark_followup_attempt_1",
      value: 11,
    }),
    metricPoint({
      date: "2026-04-02",
      observedAt: "2026-04-02T09:00:00.000Z",
      recordId: "evt_benchmark_followup_attempt_2",
      value: 12,
    }),
  ];

  const outcome = analyzeExperimentOutcome(vault, slug, {
    asOf: "2026-04-02",
    metricPoints,
  });

  assert.equal(outcome.metricResults[0]?.baselineMean, 10);
  assert.equal(outcome.metricResults[0]?.interventionMean, 12);
  assert.equal(outcome.metricResults[0]?.deltaAbs, 2);
  assert.equal(outcome.metricResults[0]?.points?.length, 2);
});

test("incompatible custom outcome units fail closed without a false delta", () => {
  const slug = "incompatible-unit-review";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-incompatible-units",
    metadata: { timezone: "UTC" },
    entities: [makeExperiment({
      slug,
      runPlan: {
        baselineStart: "2026-04-01",
        baselineEnd: "2026-04-01",
        interventionStart: "2026-04-02",
        interventionEnd: "2026-04-02",
        modality: "movement practice",
      },
      analysisPlan: {
        primaryOutcome: {
          kind: "metric",
          key: "biomarker:movement-benchmark",
          statistic: "latest",
        },
      },
    })],
  });
  const outcome = analyzeExperimentOutcome(vault, slug, {
    asOf: "2026-04-02",
    metricPoints: [
      metricPoint({
        biomarkerKey: "biomarker:movement-benchmark",
        date: "2026-04-01",
        metricKey: "movement-benchmark",
        recordId: "evt_movement_baseline",
        unit: "repetitions",
        value: 10,
      }),
      metricPoint({
        biomarkerKey: "biomarker:movement-benchmark",
        date: "2026-04-02",
        metricKey: "movement-benchmark",
        recordId: "evt_movement_followup",
        unit: "seconds",
        value: 12,
      }),
    ],
  });
  const metric = outcome.metricResults[0];

  assert.equal(metric?.baselineMean, 10);
  assert.equal(metric?.interventionMean, 12);
  assert.equal(metric?.deltaAbs, null);
  assert.equal(metric?.deltaPct, null);
  assert.equal(metric?.completeness, "insufficient");
  assert.equal(metric?.unit, null);
});

test("a planned baseline does not hide ordinary metric-window evidence", () => {
  const slug = "planned-measurement-fallback";
  const outcomeKey = "biomarker:repetition-capacity";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-planned-measurement-fallback",
    metadata: { timezone: "UTC" },
    entities: [makeExperiment({
      slug,
      runPlan: {
        baselineStart: "2026-04-01",
        baselineEnd: "2026-04-01",
        interventionStart: "2026-04-02",
        interventionEnd: "2026-04-02",
        modality: "movement practice",
      },
      analysisPlan: {
        primaryOutcome: {
          kind: "metric",
          key: outcomeKey,
          statistic: "latest",
        },
        plannedMeasurements: [
          {
            biomarkerKeys: [outcomeKey],
            kind: "manual_measurement",
            role: "baseline",
            targetWindow: { start: "2026-04-01", end: "2026-04-01" },
          },
          {
            biomarkerKeys: [outcomeKey],
            kind: "manual_measurement",
            role: "followup",
            targetWindow: { start: "2026-04-02", end: "2026-04-02" },
          },
        ],
      },
    })],
  });

  const outcome = analyzeExperimentOutcome(vault, slug, {
    asOf: "2026-04-02",
    metricPoints: [
      metricPoint({ date: "2026-04-01", recordId: "evt_baseline_window", value: 10 }),
      metricPoint({ date: "2026-04-02", recordId: "evt_followup_window", value: 12 }),
    ],
  });

  assert.equal(outcome.metricResults[0]?.baselineMean, 10);
  assert.equal(outcome.metricResults[0]?.interventionMean, 12);
});

test("custom session fields become outcome points without global registration", () => {
  const slug = "custom-session-outcome";
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJZZ";
  const fieldId = "movement_quality_score";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-custom-session-field",
    metadata: { timezone: "UTC" },
    entities: [
      makeExperiment({
        slug,
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-01",
          interventionStart: "2026-04-02",
          interventionEnd: "2026-04-02",
          logging: { sessionFields: [fieldId] },
          modality: "mobility practice",
        },
        analysisPlan: {
          primaryOutcome: {
            capture: {
              fieldId,
              kind: "session_field",
              unit: "score",
            },
            key: "biomarker:movement-quality-score",
            kind: "metric",
            statistic: "latest",
          },
        },
      }),
      sessionEntity({
        date: "2026-04-01",
        experimentId,
        fieldId,
        recordId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3AA",
        slug,
        value: 4,
      }),
      sessionEntity({
        date: "2026-04-02",
        experimentId,
        fieldId,
        recordId: "evt_01JNV45RHN0TQ9ZXE0A7YSE3AB",
        slug,
        value: 7,
      }),
    ],
  });

  const outcome = analyzeExperimentOutcome(vault, slug, { asOf: "2026-04-02" });
  const progress = summarizeExperimentProgress(vault, slug, { asOf: "2026-04-02" });

  assert.equal(outcome.metricResults[0]?.deltaAbs, 3);
  assert.deepEqual(progress.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.equal(progress.signals[0]?.baselineMean, 4);
  assert.equal(progress.signals[0]?.interventionMean, 7);
});

test("derived metric outcomes retain their own identity and count source observations", () => {
  const slug = "derived-observation-count";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-derived-count",
    metadata: { timezone: "UTC" },
    entities: [makeExperiment({
      slug,
      runPlan: {
        baselineStart: "2026-04-01",
        baselineEnd: "2026-04-01",
        interventionStart: "2026-04-02",
        interventionEnd: "2026-04-02",
        modality: "daily practice",
      },
      analysisPlan: {
        primaryOutcome: {
          capture: {
            kind: "derived_metric",
            sourceMetricKey: "completed-practice-event",
          },
          key: "biomarker:practice-frequency",
          kind: "metric",
          statistic: "count",
        },
      },
    })],
  });
  const metricPoints = [
    metricPoint({
      date: "2026-04-01",
      metricKey: "completed-practice-event",
      observedAt: "2026-04-01T08:00:00.000Z",
      recordId: "evt_practice_baseline_1",
      unit: "count",
      value: 1,
    }),
    metricPoint({
      date: "2026-04-01",
      metricKey: "completed-practice-event",
      observedAt: "2026-04-01T09:00:00.000Z",
      recordId: "evt_practice_baseline_2",
      unit: "count",
      value: 1,
    }),
    metricPoint({
      date: "2026-04-02",
      metricKey: "completed-practice-event",
      observedAt: "2026-04-02T08:00:00.000Z",
      recordId: "evt_practice_followup_1",
      unit: "count",
      value: 1,
    }),
    metricPoint({
      date: "2026-04-02",
      metricKey: "completed-practice-event",
      observedAt: "2026-04-02T09:00:00.000Z",
      recordId: "evt_practice_followup_2",
      unit: "count",
      value: 1,
    }),
    metricPoint({
      date: "2026-04-02",
      metricKey: "completed-practice-event",
      observedAt: "2026-04-02T10:00:00.000Z",
      recordId: "evt_practice_followup_3",
      unit: "count",
      value: 1,
    }),
  ];

  const outcome = analyzeExperimentOutcome(vault, slug, {
    asOf: "2026-04-02",
    metricPoints,
  });
  const metric = outcome.metricResults[0];

  assert.equal(metric?.biomarkerKey, "biomarker:practice-frequency");
  assert.equal(metric?.baselineMean, 2);
  assert.equal(metric?.interventionMean, 3);
  assert.equal(metric?.deltaAbs, 1);
  assert.equal(metric?.unit, "count");
});

test("structured review experiments close without fabricating metric deltas", () => {
  const slug = "movement-quality-review";
  const outcomeKey = "biomarker:movement-quality-review";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-structured-review",
    metadata: { timezone: "UTC" },
    entities: [
      makeExperiment({
        slug,
        status: "completed",
        runPlan: {
          interventionStart: "2026-04-01",
          interventionEnd: "2026-04-14",
          modality: "mobility practice",
        },
        analysisPlan: {
          primaryOutcome: {
            kind: "structured_review",
            key: outcomeKey,
            label: "Movement quality",
          },
          measurementAnchors: [
            {
              role: "baseline",
              kind: "document",
              recordId: "evt_movement_baseline_video",
              biomarkerKeys: [outcomeKey],
              observedOn: "2026-04-01",
            },
            {
              role: "followup",
              kind: "document",
              recordId: "evt_movement_followup_video",
              biomarkerKeys: [outcomeKey],
              observedOn: "2026-04-14",
            },
          ],
          plannedMeasurements: [
            {
              role: "baseline",
              kind: "photo",
              targetWindow: { start: "2026-04-01", end: "2026-04-01" },
              biomarkerKeys: [outcomeKey],
            },
            {
              role: "followup",
              kind: "photo",
              targetWindow: { start: "2026-04-14", end: "2026-04-14" },
              biomarkerKeys: [outcomeKey],
            },
          ],
        },
      }),
      evidenceEntity({
        date: "2026-04-01",
        kind: "document",
        recordId: "evt_movement_baseline_video",
        slug,
      }),
      evidenceEntity({
        date: "2026-04-14",
        kind: "document",
        recordId: "evt_movement_followup_video",
        slug,
      }),
    ],
  });

  const progress = summarizeExperimentProgress(vault, slug, { asOf: "2026-04-14" });
  const outcome = analyzeExperimentOutcome(vault, slug, { asOf: "2026-04-14" });

  assert.deepEqual(progress.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.equal(progress.dataCoverage.status, "ready_for_review");
  assert.deepEqual(outcome.metricResults, []);
  assert.deepEqual(outcome.structuredReview, {
    baseline: {
      kinds: ["document"],
      recordIds: ["evt_movement_baseline_video"],
    },
    followup: {
      kinds: ["document"],
      recordIds: ["evt_movement_followup_video"],
    },
    key: outcomeKey,
    kind: "structured_review",
    label: "Movement quality",
    status: "ready_for_review",
  });
  assert.match(outcome.conclusion.headline, /ready for a structured before-and-after review/u);
  assert.doesNotMatch(outcome.conclusion.plainLanguage, /\d+%/u);
});

test("structured review readiness ignores unresolved evidence anchors", () => {
  const slug = "movement-quality-missing-evidence";
  const outcomeKey = "biomarker:movement-quality-review";
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/open-ended-structured-review-missing",
    metadata: { timezone: "UTC" },
    entities: [makeExperiment({
      slug,
      status: "completed",
      runPlan: {
        interventionStart: "2026-04-01",
        interventionEnd: "2026-04-14",
        modality: "mobility practice",
      },
      analysisPlan: {
        primaryOutcome: {
          kind: "structured_review",
          key: outcomeKey,
          label: "Movement quality",
        },
        measurementAnchors: [
          {
            role: "baseline",
            kind: "document",
            recordId: "evt_missing_baseline_evidence",
            biomarkerKeys: [outcomeKey],
            observedOn: "2026-04-01",
          },
          {
            role: "followup",
            kind: "document",
            recordId: "evt_missing_followup_evidence",
            biomarkerKeys: [outcomeKey],
            observedOn: "2026-04-14",
          },
        ],
      },
    })],
  });

  const progress = summarizeExperimentProgress(vault, slug, { asOf: "2026-04-14" });
  const outcome = analyzeExperimentOutcome(vault, slug, { asOf: "2026-04-14" });

  assert.equal(progress.dataCoverage.status, "insufficient");
  assert.equal(outcome.structuredReview?.status, "missing");
  assert.deepEqual(outcome.structuredReview?.baseline.recordIds, []);
  assert.deepEqual(outcome.structuredReview?.followup.recordIds, []);
  assert.match(outcome.conclusion.headline, /needs baseline and follow-up evidence/u);
});
