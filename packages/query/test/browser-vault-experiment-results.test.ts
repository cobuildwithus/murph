import assert from "node:assert/strict";

import { test } from "vitest";

import type { ExperimentAdherenceTarget } from "@murphai/contracts";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  selectBrowserVaultExperimentResults,
  type BrowserVaultEntity,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
} from "../src/browser.ts";
import {
  buildExperimentAdherenceCalendar,
  type ExperimentAdherenceObservation,
} from "../src/experiment-adherence.ts";

type CanonicalEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

test("returns null when no matching private run exists", () => {
  const client = createBrowserVaultQueryClient(createReplica());

  assert.equal(
    selectBrowserVaultExperimentResults(client, "missing-run", {
      asOf: "2026-04-10T12:00:00.000Z",
    }),
    null,
  );
});

test("expands sparse weekday adherence schedules by expected cells instead of raw span", () => {
  const target = {
    targetId: "weekly-check-in",
    label: "Weekly check-in",
    phase: "intervention",
    calendar: {
      kind: "weekdays",
      timeZone: "UTC",
      weekdays: [1],
    },
    evidence: {
      kind: "linkedEventCount",
      eventKind: "intervention_session",
      missing: "missed_after_grace",
    },
  } satisfies ExperimentAdherenceTarget;

  const result = buildExperimentAdherenceCalendar({
    asOf: "2035-01-01",
    targets: [target],
    windows: {
      baselineEnd: null,
      baselineStart: null,
      interventionEnd: "2034-12-31",
      interventionStart: "2026-01-01",
    },
  });

  assert.equal(result.cells.length, 469);
  assert.equal(result.cells[0]?.localDate, "2026-01-05");
});

test("matches private runs by experiment id slug and protocol keys", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          id: "exp_completed",
          slug: "older-sauna-run",
          status: "completed",
          occurredAt: "2026-04-01T08:00:00.000Z",
        }),
        experimentEntity({
          id: "exp_active",
          slug: "active-sauna-run",
          status: "active",
          occurredAt: "2026-04-02T08:00:00.000Z",
        }),
      ],
    }),
  );

  assert.equal(
    selectBrowserVaultExperimentResults(client, { experimentId: "exp_active" })?.experiment.id,
    "exp_active",
  );
  assert.equal(
    selectBrowserVaultExperimentResults(client, { slug: "active-sauna-run" })?.experiment.slug,
    "active-sauna-run",
  );
  assert.equal(
    selectBrowserVaultExperimentResults(client, { protocolKeys: ["protocol:finnish-sauna"] })
      ?.experiment.id,
    "exp_active",
  );
});

test("uses the latest active matching private run when lookup candidates tie", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          id: "exp_active_old",
          slug: "sauna-old",
          status: "active",
          occurredAt: "2026-04-01T08:00:00.000Z",
        }),
        experimentEntity({
          id: "exp_active_new",
          slug: "sauna-new",
          status: "active",
          occurredAt: "2026-04-10T08:00:00.000Z",
        }),
      ],
    }),
  );

  assert.equal(
    selectBrowserVaultExperimentResults(client, { protocolKeys: ["protocol:finnish-sauna"] })
      ?.experiment.id,
    "exp_active_new",
  );
});

test.each([
  ["active", "exp_active_older"],
  ["in_progress", "exp_in_progress_older"],
  ["running", "exp_running_older"],
  ["ongoing", "exp_ongoing_older"],
  ["open", "exp_open_older"],
] as const)(
  "prioritizes %s matching runs over newer completed matching runs",
  (status, expectedId) => {
    const client = createBrowserVaultQueryClient(
      createReplica({
        entities: [
          experimentEntity({
            id: "exp_completed_newer",
            slug: `sauna-completed-newer-${status}`,
            status: "completed",
            occurredAt: "2026-04-15T08:00:00.000Z",
          }),
          experimentEntity({
            id: expectedId,
            slug: `sauna-${status}-older`,
            status,
            occurredAt: "2026-04-10T08:00:00.000Z",
          }),
        ],
      }),
    );

    assert.equal(
      selectBrowserVaultExperimentResults(client, { protocolKeys: ["protocol:finnish-sauna"] })
        ?.experiment.id,
      expectedId,
    );
  },
);

test("builds active baseline results using generatedAt as the default asOf", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-04T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-21",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 14,
            minimumUsefulSessions: 8,
          },
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-02", 61],
        ["2026-04-03", 63],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, {
    slug: "finnish-sauna-run",
  });

  assert.ok(result);
  assert.equal(result.asOf, "2026-04-04T12:00:00.000Z");
  assert.equal(result.experiment.phase, "baseline");
  assert.equal(result.progress?.phase, "baseline");
  assert.equal(result.outcome, null);
  assert.equal(result.biomarkers[0]?.status, "available");
  assert.equal(result.biomarkers[0]?.baseline.daysWithData, 3);
  assert.equal(result.biomarkers[0]?.intervention.daysWithData, 0);
  assert.equal(result.biomarkers[0]?.points.every((point) => point.phase === "baseline"), true);
  assert.equal(result.schedule?.cells[0]?.kind, "scheduled");
  assert.equal(Object.hasOwn(result, "events"), false);
});

test("uses measurement anchors for lab-backed browser experiment results outside run windows", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-08-02T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_psyllium",
          slug: "psyllium-ldl",
          status: "completed",
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
          runPlan: {
            baselineStart: "2026-05-02",
            baselineEnd: "2026-05-08",
            interventionStart: "2026-05-09",
            interventionEnd: "2026-08-01",
          },
        }),
      ],
      metricRows: [
        metricRow({
          biomarkerKey: "biomarker:ldl-c",
          date: "2026-04-23",
          metricKey: "ldl-c",
          recordIds: ["evt_lipid_baseline"],
          sourceKind: "test-result",
          unit: "mg/dL",
          value: 140,
        }),
        metricRow({
          biomarkerKey: "biomarker:ldl-c",
          date: "2026-08-02",
          metricKey: "ldl-c",
          recordIds: ["evt_lipid_followup"],
          sourceKind: "test-result",
          unit: "mg/dL",
          value: 120,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "psyllium-ldl", {
    asOf: "2026-08-02T12:00:00.000Z",
  });

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.baseline.mean, 140);
  assert.equal(result.biomarkers[0]?.baseline.start, "2026-04-23");
  assert.equal(result.biomarkers[0]?.intervention.mean, 120);
  assert.equal(result.biomarkers[0]?.intervention.start, "2026-08-02");
  assert.equal(result.biomarkers[0]?.deltaAbs, -20);
  assert.deepEqual(result.biomarkers[0]?.points.map((point) => point.phase), [
    "baseline",
    "intervention",
  ]);
});

test("reports missing browser setup without pretending wearable data is missing", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-04T12:00:00.000Z",
      entities: [
        experimentEntity({
          omitRunPlan: true,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, {
    slug: "finnish-sauna-run",
  });

  assert.ok(result);
  assert.equal(result.experiment.phase, "planned");
  assert.equal(result.progress?.phase, "planned");
  assert.equal(result.progress?.dayInRun, null);
  assert.equal(result.progress?.dataCoverage.status, "insufficient");
  assert.deepEqual(result.progress?.setupReadiness, {
    status: "incomplete",
    blockingReasons: [
      "missing_run_plan",
      "missing_baseline_window",
      "missing_intervention_window",
    ],
  });
});

test("builds active intervention progress and treats skipped sessions as missed in adherence v1", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-12T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-14",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 7,
            minimumUsefulSessions: 4,
          },
        }),
        sessionEvent("2026-04-08", "completed"),
        sessionEvent("2026-04-09", "partial"),
        sessionEvent("2026-04-10", "skipped"),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-02", 61],
        ["2026-04-03", 63],
        ["2026-04-08", 60],
        ["2026-04-09", 59],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "exp_sauna", {
    asOf: "2026-04-12T12:00:00.000Z",
  });

  assert.ok(result);
  assert.equal(result.experiment.phase, "intervention");
  assert.equal(result.progress?.adherence.completedSessions, 1);
  assert.equal(result.progress?.adherence.partialSessions, 1);
  assert.equal(result.progress?.adherence.skippedSessions, 0);
  assert.equal(result.progress?.adherence.missedSessions, 2);
  assert.equal(result.progress?.adherence.loggedSessions, 2);
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.source === "event")
      .map((cell) => [cell.localDate, cell.kind]),
    [
      ["2026-04-08", "completed"],
      ["2026-04-09", "partial"],
      ["2026-04-10", "missed"],
    ],
  );
  assert.equal(result.biomarkers[0]?.intervention.daysWithData, 2);
});

test("projects session confounders symptoms and notes as browser-safe run context", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-12T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-14",
          },
        }),
        sessionEvent("2026-04-08", "completed", {
          attributes: {
            afterExercise: true,
            confounders: {
              travel: true,
              trainingLoad: "heavy",
              skipped: false,
            },
            note: "Felt lightheaded near the end.",
            symptoms: ["lightheaded"],
          },
        }),
        contextEvent("2026-04-09", {
          contextType: "late_caffeine",
          note: "Coffee after dinner.",
          severity: "potential_confounder",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "exp_sauna");

  assert.ok(result);
  assert.deepEqual(result.context, [
    {
      confounders: ["After exercise", "Travel", "Training Load: heavy"],
      date: "2026-04-08",
      id: "evt_2026-04-08_completed",
      kind: "session",
      note: "Felt lightheaded near the end.",
      symptoms: ["lightheaded"],
    },
    {
      confounders: ["Late Caffeine"],
      date: "2026-04-09",
      id: "evt_context_2026-04-09",
      kind: "context",
      note: "Coffee after dinner.",
      symptoms: [],
    },
  ]);
  assert.equal(Object.hasOwn(result, "events"), false);
});

test("matches session events to schedule cells using the run schedule time zone", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-11T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-11",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
          },
        }),
        sessionEvent("2026-04-11", "completed", {
          occurredAt: "2026-04-11T03:30:00.000Z",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run", {
    asOf: "2026-04-11T12:00:00.000Z",
  });

  assert.ok(result);
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.source === "event")
      .map((cell) => [cell.localDate, cell.kind]),
    [["2026-04-10", "completed"]],
  );
});

test("buckets session events by scheduledLocalDate before occurredAt", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-11T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-11",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
          },
        }),
        sessionEvent("2026-04-11", "completed", {
          attributes: {
            scheduledLocalDate: "2026-04-09",
          },
          occurredAt: "2026-04-11T03:30:00.000Z",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run", {
    asOf: "2026-04-11T12:00:00.000Z",
  });

  assert.ok(result);
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.source === "event")
      .map((cell) => [cell.localDate, cell.kind]),
    [["2026-04-09", "completed"]],
  );
});

test("uses the run schedule time zone for phase and adherence dates", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-08T01:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-14",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/Los_Angeles",
            },
            targetSessions: 7,
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "baseline");
  assert.equal(result.progress?.phase, "baseline");
  assert.equal(result.progress?.adherence.expectedSessionsByNow, null);
});

test("includes timestamped session events by run-local date before asOf filtering", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-30T03:30:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-22",
            baselineEnd: "2026-04-28",
            interventionStart: "2026-04-29",
            interventionEnd: "2026-04-29",
            schedule: {
              kind: "dailyLocal",
              localTime: "20:00",
              timeZone: "America/Los_Angeles",
            },
            targetSessions: 1,
          },
        }),
        sessionEvent("2026-04-30", "completed", {
          occurredAt: "2026-04-30T03:00:00.000Z",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.source === "event")
      .map((cell) => [cell.localDate, cell.kind]),
    [["2026-04-29", "completed"]],
  );
  assert.equal(result.progress?.adherence.completedSessions, 1);
});

test("uses explicit session local dates for after-midnight session logs", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-11T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-10",
            interventionEnd: "2026-04-11",
            schedule: {
              kind: "dailyLocal",
              localTime: "20:00",
              timeZone: "America/New_York",
            },
            targetSessions: 2,
          },
        }),
        sessionEvent("2026-04-11", "completed", {
          attributes: {
            sessionLocalDate: "2026-04-10",
          },
          occurredAt: "2026-04-11T04:30:00.000Z",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.source === "event")
      .map((cell) => [cell.localDate, cell.kind]),
    [["2026-04-10", "completed"]],
  );
});

test("computes expected sessions from structured schedule cells when a schedule exists", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-08T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-05",
            interventionStart: "2026-04-06",
            interventionEnd: "2026-04-12",
            schedule: {
              kind: "cron",
              expression: "0 8 * * 4",
              timeZone: "America/New_York",
            },
            targetSessions: 1,
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.progress?.adherence.expectedSessionsByNow, 0);
});

test("does not mark adherence behind before the next scheduled session is due", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-08T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-05",
            interventionStart: "2026-04-06",
            interventionEnd: "2026-04-12",
            schedule: {
              kind: "cron",
              expression: "0 8 * * 2,4",
              timeZone: "America/New_York",
            },
            targetSessions: 6,
          },
        }),
        sessionEvent("2026-04-07", "completed"),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.progress?.adherence.loggedSessions, 1);
  assert.equal(result.progress?.adherence.expectedSessionsByNow, 1);
  assert.equal(result.progress?.adherence.status, "on_track");
});

test("builds finished outcomes when enough baseline and intervention data exists", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          status: "completed",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 3,
            minimumUsefulSessions: 2,
          },
        }),
        sessionEvent("2026-04-04", "completed"),
        sessionEvent("2026-04-05", "completed"),
        sessionEvent("2026-04-06", "completed"),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 63],
        ["2026-04-02", 62],
        ["2026-04-03", 61],
        ["2026-04-04", 59],
        ["2026-04-05", 58],
        ["2026-04-06", 57],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "completed");
  assert.equal(result.progress?.dataCoverage.status, "ready_for_review");
  assert.equal(result.outcome?.status, "enough_data");
  assert.equal(result.outcome?.confidence.level, "high");
  assert.equal(result.biomarkers[0]?.completeness, "good");
  assert.equal(result.biomarkers[0]?.deltaAbs, -4);
  assert.equal(result.biomarkers[0]?.movedAsExpected, true);
});

test("treats done private runs as review-due outcomes", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          status: "done",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 3,
            minimumUsefulSessions: 2,
          },
        }),
        sessionEvent("2026-04-04", "completed"),
        sessionEvent("2026-04-05", "completed"),
        sessionEvent("2026-04-06", "completed"),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 63],
        ["2026-04-02", 62],
        ["2026-04-03", 61],
        ["2026-04-04", 59],
        ["2026-04-05", 58],
        ["2026-04-06", 57],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.status, "done");
  assert.equal(result.experiment.phase, "review_due");
  assert.equal(result.outcome?.status, "enough_data");
  assert.equal(result.outcome?.confidence.level, "high");
});

test("keeps sparse finished outcomes low-confidence instead of inventing certainty", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          status: "completed",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
            targetSessions: 3,
            minimumUsefulSessions: 2,
          },
        }),
        sessionEvent("2026-04-04", "completed"),
      ],
      metricRows: restingHeartRateRows([["2026-04-01", 63]]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.status, "available");
  assert.equal(result.biomarkers[0]?.completeness, "partial");
  assert.equal(result.outcome?.status, "sparse_data");
  assert.equal(result.outcome?.confidence.level, "low");
  assert.ok(
    result.outcome?.confidence.reasons.some((reason) =>
      reason.includes("Primary biomarker coverage is insufficient"),
    ),
  );
});

test("represents unsupported biomarkers instead of dropping them", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
            secondaryBiomarkerKeys: ["biomarker:morning-blood-pressure"],
            desiredDirection: "decrease",
          },
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.deepEqual(
    result.biomarkers.map((biomarker) => [biomarker.biomarkerKey, biomarker.status]),
    [
      ["biomarker:resting-heart-rate", "available"],
      ["biomarker:morning-blood-pressure", "unsupported_source"],
    ],
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "unsupported_biomarker" &&
        diagnostic.biomarkerKey === "biomarker:morning-blood-pressure",
    ),
  );
});

test("uses explicit per-biomarker directions without inheriting the primary direction", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:hrv-rmssd",
            secondaryBiomarkerKeys: [
              "biomarker:resting-heart-rate",
              "biomarker:sleep-efficiency",
            ],
            desiredDirection: "increase",
            expectedDirections: [
              { biomarkerKey: "biomarker:hrv-rmssd", direction: "increase" },
              { biomarkerKey: "biomarker:resting-heart-rate", direction: "decrease" },
            ],
          },
        }),
      ],
      metricRows: [
        metricRow({ date: "2026-04-01", metricKey: "hrv-rmssd", unit: "ms", value: 60 }),
        metricRow({ date: "2026-04-08", metricKey: "hrv-rmssd", unit: "ms", value: 65 }),
        metricRow({ date: "2026-04-01", metricKey: "resting-heart-rate", unit: "bpm", value: 50 }),
        metricRow({ date: "2026-04-08", metricKey: "resting-heart-rate", unit: "bpm", value: 48 }),
        metricRow({ date: "2026-04-01", metricKey: "sleep-efficiency", unit: "%", value: 90 }),
        metricRow({ date: "2026-04-08", metricKey: "sleep-efficiency", unit: "%", value: 91 }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.expectedEffect.direction, "increase");
  assert.equal(result.biomarkers[0]?.movedAsExpected, true);
  assert.equal(result.biomarkers[1]?.expectedEffect.direction, "decrease");
  assert.equal(result.biomarkers[1]?.movedAsExpected, true);
  assert.equal(result.biomarkers[2]?.expectedEffect.direction, null);
  assert.equal(result.biomarkers[2]?.movedAsExpected, null);
});

test("keeps supported biomarkers with no browser points as no_data", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
            desiredDirection: "decrease",
          },
        }),
      ],
      metricRows: [],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.status, "no_data");
  assert.equal(result.biomarkers[0]?.points.length, 0);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "sparse_data" &&
        diagnostic.biomarkerKey === "biomarker:resting-heart-rate",
    ),
  );
});

test("keeps expected-effect records without creating an expected range band", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              description: "Watch averaged resting heart rate without expecting a guaranteed drop.",
              expected: "mixed_or_contextual",
              sourceKeys: ["source_artifact:example"],
            },
          ],
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.expectedEffect.direction, "mixed");
  assert.equal(result.biomarkers[0]?.expectedEffect.expectedRange, null);
  assert.deepEqual(result.biomarkers[0]?.expectedEffect.sourceKeys, ["source_artifact:example"]);
});

test("does not expand experiment metric windows beyond the browser-safe range", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "1900-01-01",
            baselineEnd: "9999-12-31",
            interventionStart: "1900-01-01",
            interventionEnd: "9999-12-31",
            targetSessions: 6,
            minimumUsefulSessions: 4,
          },
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.status, "unavailable");
});

test("parses only complete expected-effect ranges", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              range: {
                startDay: 8,
                endDay: 14,
                low: -5,
                high: -2,
                scale: "percent",
                sourceKeys: ["source_artifact:range"],
              },
            },
          ],
        }),
        experimentEntity({
          id: "exp_bad_range",
          slug: "bad-range-run",
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              range: {
                startDay: 8,
                low: -5,
                high: -2,
                scale: "percent",
              },
            },
          ],
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const valid = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");
  const malformed = selectBrowserVaultExperimentResults(client, "bad-range-run");

  assert.equal(valid?.biomarkers[0]?.expectedEffect.expectedRange?.scale, "percent");
  assert.equal(valid?.biomarkers[0]?.expectedEffect.expectedRange?.dayOrigin, "run");
  assert.deepEqual(valid?.biomarkers[0]?.expectedEffect.expectedRange?.sourceKeys, [
    "source_artifact:range",
  ]);
  assert.equal(malformed?.biomarkers[0]?.expectedEffect.expectedRange, null);
});

test("lets expected-effect ranges inherit parent source keys", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              sourceKeys: ["source_artifact:parent"],
              range: {
                startDay: 8,
                endDay: 14,
                low: -5,
                high: -2,
                scale: "percent",
              },
            },
          ],
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.deepEqual(result?.biomarkers[0]?.expectedEffect.expectedRange?.sourceKeys, [
    "source_artifact:parent",
  ]);
});

test("parses explicit intervention-origin expected-effect ranges", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              sourceKeys: ["source_artifact:parent"],
              range: {
                dayOrigin: "intervention",
                startDay: 1,
                endDay: 7,
                low: -5,
                high: -2,
                scale: "percent",
              },
            },
          ],
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.equal(result?.biomarkers[0]?.expectedEffect.expectedRange?.dayOrigin, "intervention");
  assert.equal(result?.biomarkers[0]?.expectedEffect.expectedRange?.startDay, 1);
});

test("drops expected-effect ranges with unsupported day origins", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              sourceKeys: ["source_artifact:parent"],
              range: {
                dayOrigin: "baseline",
                startDay: 1,
                endDay: 7,
                low: -5,
                high: -2,
                scale: "percent",
              },
            },
          ],
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.equal(result?.biomarkers[0]?.expectedEffect.expectedRange, null);
});

test("returns null schedule when the run has no structured schedule", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.schedule, null);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "no_schedule"));
});

test("counts calendar-less browser running adherence from activity sessions by sport", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_run_block",
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
        activitySessionEvent({ id: "evt_run_1", date: "2026-06-01", activityType: "Running" }),
        activitySessionEvent({ id: "evt_run_2", date: "2026-06-03", activityType: "Run" }),
        activitySessionEvent({ id: "evt_run_3", date: "2026-06-05", activityType: "Morning run" }),
        activitySessionEvent({ id: "evt_run_4", date: "2026-06-08", activityType: "Trail running" }),
        activitySessionEvent({ id: "evt_bike_1", date: "2026-06-02", activityType: "Cycling" }),
        activitySessionEvent({ id: "evt_walk_1", date: "2026-06-04", activityType: "Walking" }),
        activitySessionEvent({ id: "evt_strength_1", date: "2026-06-06", activityType: "Strength" }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug: "run-block" });
  const evidence = result?.adherence?.targets[0]?.evidence;

  assert.ok(result);
  assert.equal(result.progress?.adherence.completedSessions, 4);
  assert.equal(result.progress?.adherence.loggedSessions, 4);
  assert.equal(result.progress?.adherence.expectedSessionsByNow, 7);
  assert.equal(result.progress?.adherence.status, "behind");
  assert.equal(result.adherence?.targets[0]?.calendar, undefined);
  assert.equal(evidence?.kind, "linkedEventCount");
  if (evidence?.kind === "linkedEventCount") {
    assert.equal(evidence.eventKind, "activity_session");
    assert.equal(evidence.activityKind, "running");
  }
  assert.deepEqual(result.schedule?.cells, []);
});

test("counts browser running adherence after the real replica projects activity session classifications", async () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFN";
  const slug = "device-run-block";
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "b".repeat(64),
    vault: createVaultReadModel({
      entities: [
        canonicalExperimentEntity({
          id: experimentId,
          slug,
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
        canonicalActivitySessionEvent({
          activityType: "Running",
          date: "2026-06-01",
          id: "evt_device_run_1",
          sportName: "Running",
        }),
        canonicalActivitySessionEvent({
          activityType: "Run",
          date: "2026-06-03",
          id: "evt_device_run_2",
          sportName: "Run",
        }),
        canonicalActivitySessionEvent({
          activityType: "Morning run",
          date: "2026-06-05",
          id: "evt_device_run_3",
          sportName: "Running",
        }),
        canonicalActivitySessionEvent({
          activityType: "Trail running",
          date: "2026-06-08",
          id: "evt_device_run_4",
          sportName: "Trail running",
        }),
        canonicalActivitySessionEvent({
          activityType: "Cycling",
          date: "2026-06-02",
          id: "evt_device_bike_1",
          sportName: "Cycling",
        }),
        canonicalActivitySessionEvent({
          activityType: "Walking",
          date: "2026-06-04",
          id: "evt_device_walk_1",
          sportName: "Walking",
        }),
      ],
      metadata: { title: "Browser device adherence fixture" },
      vaultRoot: "browser://vault",
    }),
  });

  const projectedRun = replica.entities.find((entity) => entity.id === "evt_device_run_1");
  assert.deepEqual(projectedRun?.attributes, { activityKind: "running" });
  assert.equal(Object.hasOwn(projectedRun?.attributes ?? {}, "activityType"), false);
  assert.equal(Object.hasOwn(projectedRun?.attributes ?? {}, "sportName"), false);

  const client = createBrowserVaultQueryClient(replica);
  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.ok(result);
  assert.equal(result.progress?.adherence.completedSessions, 4);
  assert.equal(result.progress?.adherence.loggedSessions, 4);
  assert.equal(result.progress?.adherence.expectedSessionsByNow, 7);
  assert.equal(result.progress?.adherence.status, "behind");
  assert.deepEqual(result.schedule?.cells, []);
});

test("counts calendar-less browser running adherence from manual sessions", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFN";
  const slug = "manual-run-block";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: experimentId,
          slug,
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
        sessionEvent("2026-06-01", "completed", {
          id: "evt_manual_run_1",
          experimentId,
          experimentSlug: slug,
        }),
        sessionEvent("2026-06-03", "completed", {
          id: "evt_manual_run_2",
          experimentId,
          experimentSlug: slug,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.equal(result?.progress?.adherence.completedSessions, 2);
  assert.equal(result?.progress?.adherence.loggedSessions, 2);
});

test("counts mixed browser manual and device sessions for running adherence", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFG";
  const slug = "mixed-run-block";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: experimentId,
          slug,
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
        sessionEvent("2026-06-01", "completed", {
          id: "evt_mixed_manual_run_1",
          experimentId,
          experimentSlug: slug,
        }),
        activitySessionEvent({ id: "evt_mixed_device_run_1", date: "2026-06-03", activityType: "Running" }),
        activitySessionEvent({ id: "evt_mixed_bike_1", date: "2026-06-05", activityType: "Cycling" }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.equal(result?.progress?.adherence.completedSessions, 2);
  assert.equal(result?.progress?.adherence.loggedSessions, 2);
});

test("uses canonical activity date for scheduled browser running adherence", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QJFH";
  const slug = "run-date-boundary";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-02T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: experimentId,
          slug,
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
        activitySessionEvent({
          id: "evt_run_boundary_1",
          date: "2026-06-01",
          occurredAt: "2026-06-01T01:30:00.000Z",
          activityType: "Run",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, {
    slug,
  }, {
    asOf: "2026-06-02T12:00:00.000Z",
  });

  assert.equal(result?.progress?.adherence.completedSessions, 1);
  assert.equal(result?.progress?.adherence.loggedSessions, 1);
  assert.equal(
    result?.schedule?.cells.find((cell) => cell.localDate === "2026-06-01")?.kind,
    "completed",
  );
});

test("does not synthesize legacy schedules for unsupported explicit metric adherence targets", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-14",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            adherenceTargets: [{
              targetId: "step-floor",
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
            }],
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.schedule, null);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid_schedule"));
  assert.equal(result.progress?.adherence.status, "unknown");
  assert.equal(result.progress?.adherence.loggedSessions, 0);
});

test("keeps comparator-bounded metric thresholds unknown", () => {
  const target = {
    targetId: "glucose-ceiling",
    label: "Glucose ceiling",
    phase: "intervention",
    calendar: {
      kind: "daily",
      timeZone: "UTC",
    },
    evidence: {
      kind: "metricThreshold",
      metricKey: "glucose",
      op: "<=",
      value: 100,
      missing: "unknown",
    },
  } satisfies ExperimentAdherenceTarget;
  const observations: Array<ExperimentAdherenceObservation & { comparator: ">" }> = [{
    comparator: ">",
    evidenceId: "evt_glucose_1",
    localDate: "2026-04-08",
    metricKey: "glucose",
    targetId: "glucose-ceiling",
    value: 100,
  }];

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-10",
    observations,
    targets: [target],
    windows: {
      baselineEnd: null,
      baselineStart: null,
      interventionEnd: "2026-04-08",
      interventionStart: "2026-04-08",
    },
  });

  assert.equal(result.cells[0]?.status, "unknown");
  assert.equal(result.cells[0]?.score, null);
  assert.deepEqual(result.cells[0]?.evidenceIds, ["evt_glucose_1"]);
});

test("uses adherence target rollups for browser progress targets", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-11T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-10",
            adherenceTargets: [
              {
                targetId: "session-marker",
                label: "Session marker",
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
                rollup: {
                  targetCompletions: 2,
                  minimumUsefulCompletions: 1,
                },
              },
            ],
          },
        }),
        sessionEvent("2026-04-08", "completed"),
        sessionEvent("2026-04-09", "completed"),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.progress?.adherence.targetSessions, 2);
  assert.equal(result.progress?.adherence.minimumUsefulSessions, 1);
  assert.equal(result.progress?.adherence.status, "met_target");
  assert.equal(result.schedule?.completedSessions, 2);
  assert.equal(result.schedule?.plannedSessions, 3);
  assert.equal(result.schedule?.cells.length, 6);
  assert.equal(result.schedule?.cells.filter((cell) => cell.targetId === "sauna").length, 3);
});

test("does not replace metric adherence rollups with auxiliary session targets", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-10T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-08",
            adherenceTargets: [
              {
                targetId: "step-floor",
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
                rollup: {
                  targetCompletions: 1,
                  minimumUsefulCompletions: 1,
                },
              },
              {
                targetId: "session-marker",
                label: "Session marker",
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
            ],
          },
        }),
        sessionEvent("2026-04-08", "completed"),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-02", 61],
        ["2026-04-03", 63],
        ["2026-04-08", 58],
        ["2026-04-09", 57],
        ["2026-04-10", 59],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.schedule, null);
  assert.equal(result.progress?.adherence.completedSessions, 0);
  assert.equal(result.progress?.adherence.loggedSessions, 0);
  assert.equal(result.progress?.adherence.targetSessions, null);
  assert.equal(result.progress?.adherence.status, "unknown");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid_schedule"));
  assert.ok(result.outcome?.confidence.reasons.includes(
    "Browser Results cannot evaluate this experiment's adherence target yet.",
  ));
});

test("treats measurement anchors as browser analysis windows when run windows are absent", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-08-02T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_anchor_only",
          slug: "anchor-only-ldl",
          omitRunPlan: true,
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:ldl-c",
            desiredDirection: "decrease",
            measurementAnchors: [
              {
                role: "baseline",
                kind: "lab_panel",
                recordId: "evt_anchor_only_baseline",
                biomarkerKeys: ["biomarker:ldl-c"],
              },
              {
                role: "followup",
                kind: "lab_panel",
                recordId: "evt_anchor_only_followup",
                biomarkerKeys: ["biomarker:ldl-c"],
              },
            ],
          },
        }),
      ],
      metricRows: [
        metricRow({
          biomarkerKey: "biomarker:ldl-c",
          date: "2026-04-23",
          metricKey: "ldl-c",
          recordIds: ["evt_anchor_only_baseline"],
          sourceKind: "test-result",
          unit: "mg/dL",
          value: 140,
        }),
        metricRow({
          biomarkerKey: "biomarker:ldl-c",
          date: "2026-08-02",
          metricKey: "ldl-c",
          recordIds: ["evt_anchor_only_followup"],
          sourceKind: "test-result",
          unit: "mg/dL",
          value: 120,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "anchor-only-ldl");

  assert.ok(result);
  assert.deepEqual(result.progress?.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.equal(result.biomarkers[0]?.deltaAbs, -20);
});

test("treats completed lab anchor comparisons as enough browser outcome data", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-08-02T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_completed_lab",
          slug: "completed-lab-ldl",
          status: "completed",
          runPlan: {
            interventionStart: "2026-05-09",
            interventionEnd: "2026-08-01",
          },
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:ldl-c",
            desiredDirection: "decrease",
            measurementAnchors: [
              {
                role: "baseline",
                kind: "lab_panel",
                recordId: "evt_completed_lab_baseline",
                biomarkerKeys: ["biomarker:ldl-c"],
              },
              {
                role: "followup",
                kind: "lab_panel",
                recordId: "evt_completed_lab_followup",
                biomarkerKeys: ["biomarker:ldl-c"],
              },
            ],
          },
        }),
      ],
      metricRows: [
        metricRow({
          biomarkerKey: "biomarker:ldl-c",
          date: "2026-04-23",
          metricKey: "ldl-c",
          recordIds: ["evt_completed_lab_baseline"],
          sourceKind: "test-result",
          unit: "mg/dL",
          value: 140,
        }),
        metricRow({
          biomarkerKey: "biomarker:ldl-c",
          date: "2026-08-02",
          metricKey: "ldl-c",
          recordIds: ["evt_completed_lab_followup"],
          sourceKind: "test-result",
          unit: "mg/dL",
          value: 120,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "completed-lab-ldl");

  assert.ok(result);
  assert.equal(result.progress?.dataCoverage.status, "ready_for_review");
  assert.equal(result.biomarkers[0]?.completeness, "good");
  assert.equal(result.outcome?.status, "enough_data");
});

test("treats lab measurement plans as setup-ready without a run baseline window", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-05-10T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_lab_no_run_in",
          slug: "lab-no-run-in",
          runPlan: {
            interventionStart: "2026-05-09",
            interventionEnd: "2026-08-01",
          },
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:ldl-c",
            desiredDirection: "decrease",
            measurementAnchors: [
              {
                role: "baseline",
                kind: "lab_panel",
                recordId: "evt_lab_no_run_in_baseline",
                biomarkerKeys: ["biomarker:ldl-c"],
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
        }),
      ],
      metricRows: [
        metricRow({
          biomarkerKey: "biomarker:ldl-c",
          date: "2026-04-23",
          metricKey: "ldl-c",
          recordIds: ["evt_lab_no_run_in_baseline"],
          sourceKind: "test-result",
          unit: "mg/dL",
          value: 140,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "lab-no-run-in", {
    asOf: "2026-05-10T12:00:00.000Z",
  });

  assert.ok(result);
  assert.equal(result.progress?.phase, "intervention");
  assert.equal(result.progress?.dayInRun, 2);
  assert.deepEqual(result.progress?.setupReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.deepEqual(result.progress?.analysisReadiness, {
    status: "ready",
    blockingReasons: [],
  });
  assert.equal(result.progress?.windows.baselineStart, null);
  assert.equal(result.progress?.windows.baselineEnd, null);
});

test("incomplete browser point plans keep using complete run windows", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-25T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_incomplete_point",
          slug: "browser-incomplete-point",
          status: "completed",
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
            desiredDirection: "decrease",
            measurementAnchors: [
              {
                role: "baseline",
                kind: "lab_panel",
                recordId: "evt_browser_rhr_lab_baseline",
                biomarkerKeys: ["biomarker:resting-heart-rate"],
              },
            ],
          },
        }),
      ],
      metricRows: [
        metricRow({
          biomarkerKey: "biomarker:resting-heart-rate",
          date: "2026-03-25",
          metricKey: "resting-heart-rate",
          recordIds: ["evt_browser_rhr_lab_baseline"],
          unit: "bpm",
          value: 70,
        }),
        ...restingHeartRateRows([
          ["2026-04-01", 62],
          ["2026-04-02", 61],
          ["2026-04-03", 60],
          ["2026-04-08", 59],
          ["2026-04-09", 58],
          ["2026-04-10", 59],
        ]),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "browser-incomplete-point");

  assert.ok(result);
  assert.equal(result.progress?.dataCoverage.status, "ready_for_review");
  assert.equal(result.biomarkers[0]?.baseline.daysWithData, 3);
  assert.equal(result.biomarkers[0]?.baseline.mean, 61);
  assert.equal(result.biomarkers[0]?.intervention.daysWithData, 3);
  assert.equal(result.biomarkers[0]?.intervention.mean, 58.666666666666664);
});

test("requires complete lab measurement windows before skipping browser run baselines", () => {
  const cases = [
    {
      slug: "browser-baseline-only",
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:ldl-c",
        desiredDirection: "decrease",
        measurementAnchors: [
          {
            role: "baseline",
            kind: "lab_panel",
            recordId: "evt_browser_baseline_only",
            biomarkerKeys: ["biomarker:ldl-c"],
          },
        ],
      },
    },
    {
      slug: "browser-followup-only",
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
    const client = createBrowserVaultQueryClient(
      createReplica({
        generatedAt: "2026-05-10T12:00:00.000Z",
        entities: [
          experimentEntity({
            id: `exp_${testCase.slug.replaceAll("-", "_")}`,
            slug: testCase.slug,
            runPlan: {
              interventionStart: "2026-05-09",
              interventionEnd: "2026-08-01",
            },
            analysisPlan: testCase.analysisPlan,
          }),
        ],
      }),
    );

    const result = selectBrowserVaultExperimentResults(client, testCase.slug, {
      asOf: "2026-05-10T12:00:00.000Z",
    });

    assert.ok(result);
    assert.deepEqual(result.progress?.setupReadiness, {
      status: "incomplete",
      blockingReasons: ["missing_baseline_window"],
    });
    assert.deepEqual(result.progress?.analysisReadiness, {
      status: "incomplete",
      blockingReasons: ["missing_metric_window"],
    });
  }
});

function canonicalExperimentEntity(input: {
  id: string;
  runPlan: Record<string, unknown>;
  slug: string;
  status?: string;
}): CanonicalEntity {
  const status = input.status ?? "active";

  return {
    attributes: {
      analysisPlan: {
        primaryBiomarkerKey: "biomarker:resting-heart-rate",
        desiredDirection: "decrease",
      },
      commonsProtocolRef: {
        key: "protocol:running",
        pageRevisionId: "sha256:page",
        runSpecRevisionId: "sha256:run",
        testPlanId: "running-adherence",
      },
      experimentId: input.id,
      runPlan: input.runPlan,
      slug: input.slug,
      status,
    },
    body: null,
    date: "2026-05-25",
    entityId: input.id,
    experimentSlug: input.slug,
    family: "experiment",
    frontmatter: null,
    kind: "experiment",
    links: [],
    lookupIds: [input.id, input.slug],
    occurredAt: "2026-05-25T08:00:00.000Z",
    path: `bank/experiments/${input.slug}.md`,
    primaryLookupId: input.id,
    recordClass: "bank",
    relatedIds: [],
    status,
    stream: null,
    tags: ["running"],
    title: "Device running block",
  } satisfies CanonicalEntity;
}

function canonicalActivitySessionEvent(input: {
  activityType: string;
  date: string;
  id: string;
  sportName: string;
}): CanonicalEntity {
  return {
    attributes: {
      activityType: input.activityType,
      sportName: input.sportName,
    },
    body: null,
    date: input.date,
    entityId: input.id,
    experimentSlug: null,
    family: "event",
    frontmatter: null,
    kind: "activity_session",
    links: [],
    lookupIds: [input.id],
    occurredAt: `${input.date}T12:00:00.000Z`,
    path: "ledger/events/2026/2026-06.jsonl",
    primaryLookupId: input.id,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: input.activityType,
  } satisfies CanonicalEntity;
}

function createReplica(input: {
  entities?: BrowserVaultEntity[];
  generatedAt?: string;
  metricRows?: BrowserVaultMetricRow[];
} = {}): BrowserVaultReplica {
  const metricRows = input.metricRows ?? [];

  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: input.entities ?? [],
    generatedAt: input.generatedAt ?? "2026-04-10T12:00:00.000Z",
    metricGoalProgressRows: [],
    metricRows,
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: ["experiment", "event"],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "test",
      sourceBundleHash: "a".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function experimentEntity(input: {
  analysisPlan?: Record<string, unknown>;
  expectedSignalDescriptions?: unknown[];
  id?: string;
  omitRunPlan?: boolean;
  occurredAt?: string;
  runPlan?: Record<string, unknown>;
  slug?: string;
  status?: string;
} = {}): BrowserVaultEntity {
  const id = input.id ?? "exp_sauna";
  const slug = input.slug ?? "finnish-sauna-run";
  const status = input.status ?? "active";

  return {
    attributes: {
      analysisPlan: input.analysisPlan ?? {
        primaryBiomarkerKey: "biomarker:resting-heart-rate",
        desiredDirection: "decrease",
      },
      commonsProtocolRef: {
        key: "protocol:finnish-sauna",
        pageRevisionId: "sha256:page",
        runSpecRevisionId: "sha256:run",
        testPlanId: "rhr-21d",
      },
      expectedSignalDescriptions: input.expectedSignalDescriptions,
      experimentId: id,
      ...(input.omitRunPlan
        ? {}
        : {
            runPlan: input.runPlan ?? {
              baselineStart: "2026-04-01",
              baselineEnd: "2026-04-07",
              interventionStart: "2026-04-08",
              interventionEnd: "2026-04-21",
              targetSessions: 6,
              minimumUsefulSessions: 4,
            },
          }),
      slug,
      status,
    },
    bodyPreview: null,
    date: "2026-04-01",
    experimentSlug: slug,
    family: "experiment",
    id,
    kind: "experiment",
    links: [],
    lookupIds: [id, slug],
    occurredAt: input.occurredAt ?? "2026-04-01T08:00:00.000Z",
    recordClass: "bank",
    status,
    stream: null,
    tags: ["sauna"],
    title: "Finnish sauna run",
  };
}

function sessionEvent(
  date: string,
  sessionStatus: string,
  overrides: Partial<Pick<BrowserVaultEntity, "occurredAt">> & {
    attributes?: Record<string, unknown>;
    experimentId?: string;
    experimentSlug?: string;
    id?: string;
    title?: string;
  } = {},
): BrowserVaultEntity {
  const experimentId = overrides.experimentId ?? "exp_sauna";
  const experimentSlug = overrides.experimentSlug ?? "finnish-sauna-run";
  const id = overrides.id ?? `evt_${date}_${sessionStatus}`;

  return {
    attributes: {
      experimentId,
      experimentSlug,
      sessionStatus,
      ...overrides.attributes,
    },
    bodyPreview: null,
    date,
    experimentSlug,
    family: "event",
    id,
    kind: "intervention_session",
    links: [{ targetId: experimentId, type: "related" }],
    lookupIds: [id],
    occurredAt: overrides.occurredAt ?? `${date}T13:00:00.000Z`,
    recordClass: "ledger",
    status: null,
    stream: null,
    tags: ["sauna"],
    title: overrides.title ?? "Sauna session",
  };
}

function activitySessionEvent(input: {
  activityType: string;
  date: string;
  id: string;
  occurredAt?: string;
  sportName?: string;
  title?: string;
}): BrowserVaultEntity {
  return {
    attributes: {
      activityType: input.activityType,
      sportName: input.sportName ?? input.activityType,
    },
    bodyPreview: null,
    date: input.date,
    experimentSlug: null,
    family: "event",
    id: input.id,
    kind: "activity_session",
    links: [],
    lookupIds: [input.id],
    occurredAt: input.occurredAt ?? `${input.date}T12:00:00.000Z`,
    recordClass: "ledger",
    status: null,
    stream: null,
    tags: [],
    title: input.title ?? input.activityType,
  };
}

function contextEvent(
  date: string,
  attributes: Record<string, unknown>,
): BrowserVaultEntity {
  return {
    attributes: {
      experimentId: "exp_sauna",
      experimentSlug: "finnish-sauna-run",
      ...attributes,
    },
    bodyPreview: null,
    date,
    experimentSlug: "finnish-sauna-run",
    family: "event",
    id: `evt_context_${date}`,
    kind: "experiment_context",
    links: [{ targetId: "exp_sauna", type: "related" }],
    lookupIds: [`evt_context_${date}`],
    occurredAt: `${date}T13:00:00.000Z`,
    recordClass: "ledger",
    status: null,
    stream: null,
    tags: ["sauna"],
    title: "Experiment context",
  };
}

function restingHeartRateRows(entries: readonly (readonly [string, number])[]): BrowserVaultMetricRow[] {
  return entries.map(([date, value]) =>
    metricRow({
      date,
      metricKey: "resting-heart-rate",
      unit: "bpm",
      value,
    }),
  );
}

function metricRow(input: {
  biomarkerKey?: string | null;
  date: string;
  metricKey: string;
  recordIds?: string[];
  sourceKind?: string;
  unit: string;
  value: number;
}): BrowserVaultMetricRow {
  return {
    biomarkerKey: input.biomarkerKey ??
      (input.metricKey === "resting-heart-rate" ? "biomarker:resting-heart-rate" : null),
    confidence: "medium",
    context: {},
    date: input.date,
    grain: "day",
    id: `metric-row:${input.metricKey}:${input.date}`,
    metricKey: input.metricKey,
    observedAt: `${input.date}T00:00:00.000Z`,
    pointIds: [`metric-point:${input.metricKey}:${input.date}`],
    recordIds: input.recordIds ?? [],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "derived",
    sourceKind: input.sourceKind ?? "wearable-summary",
    sourceLabel: "Wearable summary",
    statistic: "value",
    unit: input.unit,
    value: input.value,
    valueLabel: String(input.value),
  };
}
