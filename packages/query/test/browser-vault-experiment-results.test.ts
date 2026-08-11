import assert from "node:assert/strict";

import { test } from "vitest";

import type {
  ExperimentAdherenceTarget,
  ExperimentOutcome,
} from "@murphai/contracts";
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

test("keeps elapsed progress for a paused run whose intervention end is unknown", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-05T12:00:00.000Z",
      entities: [
        experimentEntity({
          status: "paused",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "paused");
  assert.equal(result.progress?.dayInRun, 5);
  assert.deepEqual(result.progress?.setupReadiness, {
    status: "incomplete",
    blockingReasons: ["missing_intervention_window"],
  });
});

test("derives intervention progress from a known start when the end is unknown", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-05T12:00:00.000Z",
      entities: [
        experimentEntity({
          status: "active",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "intervention");
  assert.equal(result.progress?.dayInRun, 5);
  assert.deepEqual(result.progress?.setupReadiness, {
    status: "incomplete",
    blockingReasons: ["missing_intervention_window"],
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
  assert.equal(result.progress?.adherence.completedSessions, 2);
  assert.equal(result.progress?.adherence.assumedSessions, 1);
  assert.equal(result.progress?.adherence.partialSessions, 1);
  assert.equal(result.progress?.adherence.skippedSessions, 0);
  assert.equal(result.progress?.adherence.missedSessions, 1);
  assert.equal(result.progress?.adherence.loggedSessions, 3);
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
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.kind === "assumed")
      .map((cell) => [cell.localDate, cell.kind]),
    [["2026-04-11", "assumed"]],
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

test("browser SAUNA calendar cells assume done after grace and corrections override them", () => {
  const runPlan = {
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
  };
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-12T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_sauna_assumed",
          slug: "browser-sauna-assumed",
          runPlan,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "browser-sauna-assumed");

  assert.ok(result);
  assert.deepEqual(result.schedule?.cells.map((cell) => [cell.localDate, cell.kind]), [
    ["2026-04-06", "assumed"],
    ["2026-04-08", "assumed"],
    ["2026-04-10", "assumed"],
  ]);
  assert.equal(result.schedule?.completedSessions, 3);
  assert.equal(result.schedule?.assumedSessions, 3);
  assert.equal(result.progress?.adherence.completedSessions, 3);
  assert.equal(result.progress?.adherence.loggedSessions, 3);
  assert.equal(result.progress?.adherence.assumedSessions, 3);
  assert.equal(result.progress?.adherence.status, "met_target");

  const correctedClient = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-12T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_sauna_assumed",
          slug: "browser-sauna-assumed",
          runPlan,
        }),
        sessionEvent("2026-04-12", "skipped", {
          attributes: {
            sessionLocalDate: "2026-04-08",
          },
          experimentId: "exp_browser_sauna_assumed",
          experimentSlug: "browser-sauna-assumed",
          id: "evt_browser_sauna_skipped",
          occurredAt: "2026-04-12T19:00:00.000Z",
        }),
      ],
    }),
  );
  const corrected = selectBrowserVaultExperimentResults(correctedClient, "browser-sauna-assumed");

  assert.deepEqual(corrected?.schedule?.cells.map((cell) => [cell.localDate, cell.kind]), [
    ["2026-04-06", "assumed"],
    ["2026-04-08", "missed"],
    ["2026-04-10", "assumed"],
  ]);
  assert.equal(corrected?.progress?.adherence.completedSessions, 2);
  assert.equal(corrected?.progress?.adherence.loggedSessions, 2);
  assert.equal(corrected?.progress?.adherence.assumedSessions, 2);
});

test("browser TRETINOIN nightly schedule reports confirmed and assumed sessions", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-12T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_tretinoin_assumed",
          slug: "browser-tretinoin-assumed",
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
        sessionEvent("2026-04-09", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_tretinoin_assumed",
          experimentSlug: "browser-tretinoin-assumed",
          id: "evt_browser_tretinoin_manual",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "browser-tretinoin-assumed");

  assert.deepEqual(result?.schedule?.cells.map((cell) => [cell.localDate, cell.kind]), [
    ["2026-04-08", "assumed"],
    ["2026-04-09", "completed"],
    ["2026-04-10", "assumed"],
  ]);
  assert.equal(result?.progress?.adherence.completedSessions, 3);
  assert.equal(result?.progress?.adherence.loggedSessions, 3);
  assert.equal(result?.progress?.adherence.assumedSessions, 2);
  assert.equal(result?.progress?.adherence.confirmedSessions, 1);
});

test("browser device running schedules keep missed gaps and sensed sessions", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-12T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_device_run",
          slug: "browser-device-run",
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
        activitySessionEvent({
          id: "evt_browser_device_run_sensed",
          date: "2026-04-09",
          activityType: "Running",
          source: "device",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "browser-device-run");

  assert.deepEqual(result?.schedule?.cells.map((cell) => [cell.localDate, cell.kind]), [
    ["2026-04-08", "missed"],
    ["2026-04-09", "completed"],
    ["2026-04-10", "missed"],
  ]);
  assert.equal(result?.progress?.adherence.completedSessions, 1);
  assert.equal(result?.progress?.adherence.loggedSessions, 1);
  assert.equal(result?.progress?.adherence.sensedSessions, 1);
  assert.equal(result?.progress?.adherence.assumedSessions, undefined);
  assert.equal(result?.progress?.adherence.status, "behind");
});

test("counts browser count-less run-plan device sessions", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_countless_browser_run",
          slug: "countless-browser-run",
          runPlan: {
            baselineStart: "2026-05-25",
            baselineEnd: "2026-05-31",
            interventionStart: "2026-06-01",
            interventionEnd: "2026-06-28",
            modality: "Run",
          },
        }),
        activitySessionEvent({
          activityType: "workout",
          date: "2026-06-02",
          id: "evt_countless_browser_run_1",
          sportName: "Run",
        }),
        activitySessionEvent({
          activityType: "workout",
          date: "2026-06-05",
          id: "evt_countless_browser_run_2",
          sportName: "Run",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "countless-browser-run");

  assert.equal(result?.progress?.adherence.completedSessions, 2);
  assert.equal(result?.progress?.adherence.expectedSessionsByNow, null);
  assert.notEqual(result?.progress?.adherence.status, "not_started");
});

test("counts browser count-less run-plan manual sessions", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_countless_browser_sauna",
          slug: "countless-browser-sauna",
          runPlan: {
            baselineStart: "2026-05-25",
            baselineEnd: "2026-05-31",
            interventionStart: "2026-06-01",
            interventionEnd: "2026-06-28",
            modality: "sauna",
          },
        }),
        sessionEvent("2026-06-02", "completed", {
          experimentId: "exp_countless_browser_sauna",
          experimentSlug: "countless-browser-sauna",
          id: "evt_countless_browser_sauna_1",
        }),
        sessionEvent("2026-06-05", "completed", {
          experimentId: "exp_countless_browser_sauna",
          experimentSlug: "countless-browser-sauna",
          id: "evt_countless_browser_sauna_2",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "countless-browser-sauna");

  assert.equal(result?.progress?.adherence.completedSessions, 2);
  assert.equal(result?.progress?.adherence.expectedSessionsByNow, null);
  assert.notEqual(result?.progress?.adherence.status, "not_started");
});

test("browser count path treats partial intervention sessions as logged", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-10T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_partial_count_path",
          slug: "browser-partial-count-path",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-12",
            modality: "sauna",
            targetSessions: 2,
            minimumUsefulSessions: 1,
          },
        }),
        sessionEvent("2026-04-09", "partial", {
          experimentId: "exp_browser_partial_count_path",
          experimentSlug: "browser-partial-count-path",
          id: "evt_browser_partial_count_path",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "browser-partial-count-path");

  assert.equal(result?.progress?.adherence.completedSessions, 0);
  assert.equal(result?.progress?.adherence.partialSessions, 1);
  assert.equal(result?.progress?.adherence.loggedSessions, 1);
  assert.notEqual(result?.progress?.adherence.status, "not_started");
});

test("renders the exact saved outcome after raw metric rows age out", () => {
  const outcome = savedOutcome();
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2027-06-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          endedOn: "2026-04-06",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
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
      ],
      experimentOutcomes: [outcome],
      metricRows: [],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "completed");
  assert.equal(result.savedOutcomeStatus, "available");
  assert.deepEqual(result.persistedOutcome, outcome);
  assert.equal(result.outcome?.status, "enough_data");
  assert.deepEqual(result.outcome?.confidence, outcome.confidence);
  assert.equal(result.biomarkers[0]?.completeness, "good");
  assert.equal(result.biomarkers[0]?.deltaAbs, -4);
  assert.equal(result.biomarkers[0]?.baseline.mean, 62);
  assert.equal(result.biomarkers[0]?.intervention.mean, 58);
  assert.deepEqual(result.biomarkers[0]?.points, []);
  assert.equal(result.biomarkers[0]?.movedAsExpected, true);
});

test("renders current saved daily snapshots without consulting changed live rows", () => {
  const outcome = savedOutcome({
    points: [
      {
        date: "2026-04-01",
        phase: "baseline",
        unit: "bpm",
        value: 63,
      },
      {
        date: "2026-04-02",
        phase: "baseline",
        unit: "bpm",
        value: 62,
      },
      {
        date: "2026-04-03",
        phase: "baseline",
        unit: "bpm",
        value: 61,
      },
      {
        date: "2026-04-04",
        phase: "intervention",
        unit: "bpm",
        value: 59,
      },
      {
        date: "2026-04-05",
        phase: "intervention",
        unit: "bpm",
        value: 58,
      },
      {
        date: "2026-04-06",
        phase: "intervention",
        unit: "bpm",
        value: 57,
      },
    ],
    schemaVersion: "murph.experiment-outcome.v2",
  });
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          endedOn: "2026-04-06",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
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
      ],
      experimentOutcomes: [outcome],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 99],
        ["2026-04-02", 99],
        ["2026-04-03", 99],
        ["2026-04-04", 99],
        ["2026-04-05", 99],
        ["2026-04-06", 99],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.deepEqual(
    result?.biomarkers[0]?.points.map(({ date, phase, value }) => ({ date, phase, value })),
    [
      { date: "2026-04-01", phase: "baseline", value: 63 },
      { date: "2026-04-02", phase: "baseline", value: 62 },
      { date: "2026-04-03", phase: "baseline", value: 61 },
      { date: "2026-04-04", phase: "intervention", value: 59 },
      { date: "2026-04-05", phase: "intervention", value: 58 },
      { date: "2026-04-06", phase: "intervention", value: 57 },
    ],
  );
});

test("projects custom metric outcomes with their declared reducer", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            primaryOutcome: {
              key: "biomarker:repetition-capacity",
              kind: "metric",
              label: "Repetition capacity",
              statistic: "latest",
            },
          },
          id: "exp_custom_metric",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-02",
            interventionStart: "2026-04-03",
            interventionEnd: "2026-04-04",
          },
          slug: "custom-metric-run",
        }),
      ],
      metricRows: [
        metricRow({
          biomarkerKey: "biomarker:repetition-capacity",
          date: "2026-04-01",
          metricKey: "repetition-capacity",
          unit: "repetitions",
          value: 8,
        }),
        metricRow({
          biomarkerKey: "biomarker:repetition-capacity",
          date: "2026-04-02",
          metricKey: "repetition-capacity",
          unit: "repetitions",
          value: 10,
        }),
        metricRow({
          biomarkerKey: "biomarker:repetition-capacity",
          date: "2026-04-03",
          metricKey: "repetition-capacity",
          unit: "repetitions",
          value: 11,
        }),
        metricRow({
          biomarkerKey: "biomarker:repetition-capacity",
          date: "2026-04-04",
          metricKey: "repetition-capacity",
          unit: "repetitions",
          value: 12,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "custom-metric-run");
  const metric = result?.biomarkers[0];

  assert.equal(metric?.label, "Repetition capacity");
  assert.equal(metric?.statistic, "latest");
  assert.equal(metric?.sourceMetric?.metricKey, "repetition-capacity");
  assert.equal(metric?.baseline.mean, 10);
  assert.equal(metric?.intervention.mean, 12);
  assert.equal(metric?.deltaAbs, 2);
});

test("projects saved structured reviews without an empty metric result", () => {
  const base = savedOutcome({
    id: "exp_structured_review",
    schemaVersion: "murph.experiment-outcome.v2",
    slug: "structured-review-run",
  });
  const outcome: ExperimentOutcome = {
    ...base,
    metricResults: [],
    structuredReview: {
      baseline: {
        kinds: ["document"],
        recordIds: ["evt_movement_baseline"],
      },
      followup: {
        kinds: ["document"],
        recordIds: ["evt_movement_followup"],
      },
      key: "biomarker:movement-quality-review",
      kind: "structured_review",
      label: "Movement quality",
      status: "ready_for_review",
    },
  };
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            primaryOutcome: {
              key: "biomarker:movement-quality-review",
              kind: "structured_review",
              label: "Movement quality",
            },
          },
          endedOn: "2026-04-06",
          id: "exp_structured_review",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
          },
          slug: "structured-review-run",
          status: "completed",
        }),
      ],
      experimentOutcomes: [outcome],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "structured-review-run");

  assert.equal(result?.savedOutcomeStatus, "available");
  assert.equal(result?.outcome?.primaryBiomarkerKey, "biomarker:movement-quality-review");
  assert.equal(result?.outcome?.status, "ready_for_review");
  assert.deepEqual(result?.biomarkers, []);
  assert.equal(result?.persistedOutcome?.structuredReview?.label, "Movement quality");
});

test("browser structured-review readiness requires accessible evidence records", () => {
  const slug = "structured-review-live";
  const outcomeKey = "biomarker:movement-quality-review";
  const analysisPlan = {
    primaryOutcome: {
      key: outcomeKey,
      kind: "structured_review",
      label: "Movement quality",
    },
    measurementAnchors: [
      {
        biomarkerKeys: [outcomeKey],
        kind: "document",
        observedOn: "2026-04-01",
        recordId: "evt_review_baseline",
        role: "baseline",
      },
      {
        biomarkerKeys: [outcomeKey],
        kind: "document",
        observedOn: "2026-04-14",
        recordId: "evt_review_followup",
        role: "followup",
      },
    ],
  };
  const experiment = experimentEntity({
    analysisPlan,
    endedOn: "2026-04-14",
    id: "exp_structured_review_live",
    runPlan: {
      interventionEnd: "2026-04-14",
      interventionStart: "2026-04-01",
    },
    slug,
    status: "completed",
  });
  const missingEvidenceClient = createBrowserVaultQueryClient(
    createReplica({
      entities: [experiment],
      generatedAt: "2026-04-15T12:00:00.000Z",
    }),
  );
  const completeEvidenceClient = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experiment,
        structuredReviewEvidenceEntity({
          date: "2026-04-01",
          id: "evt_review_baseline",
          slug,
        }),
        structuredReviewEvidenceEntity({
          date: "2026-04-14",
          id: "evt_review_followup",
          slug,
        }),
      ],
      generatedAt: "2026-04-15T12:00:00.000Z",
    }),
  );

  assert.equal(
    selectBrowserVaultExperimentResults(missingEvidenceClient, slug)
      ?.progress?.dataCoverage.status,
    "insufficient",
  );
  assert.equal(
    selectBrowserVaultExperimentResults(completeEvidenceClient, slug)
      ?.progress?.dataCoverage.status,
    "ready_for_review",
  );
});

test("browser structured-review readiness uses evidence record dates over anchor claims", () => {
  const outcomeKey = "biomarker:movement-quality-review";
  for (const [variant, claimedObservedOn] of [
    ["omitted", undefined],
    ["incorrectly-early", "2026-04-02"],
  ] as const) {
    const slug = `structured-review-future-${variant}`;
    const experiment = experimentEntity({
      analysisPlan: {
        primaryOutcome: {
          key: outcomeKey,
          kind: "structured_review",
          label: "Movement quality",
        },
        measurementAnchors: [
          {
            biomarkerKeys: [outcomeKey],
            kind: "document",
            observedOn: "2026-04-01",
            recordId: `evt_browser_baseline_${variant}`,
            role: "baseline",
          },
          {
            biomarkerKeys: [outcomeKey],
            kind: "document",
            recordId: `evt_browser_future_followup_${variant}`,
            role: "followup",
            ...(claimedObservedOn === undefined
              ? {}
              : { observedOn: claimedObservedOn }),
          },
        ],
      },
      endedOn: "2026-04-20",
      id: `exp_structured_review_future_${variant}`,
      runPlan: {
        interventionEnd: "2026-04-14",
        interventionStart: "2026-04-01",
      },
      slug,
      status: "completed",
    });
    const client = createBrowserVaultQueryClient(
      createReplica({
        entities: [
          experiment,
          structuredReviewEvidenceEntity({
            date: "2026-04-01",
            id: `evt_browser_baseline_${variant}`,
            slug,
          }),
          structuredReviewEvidenceEntity({
            date: "2026-04-20",
            id: `evt_browser_future_followup_${variant}`,
            slug,
          }),
        ],
        generatedAt: "2026-04-21T12:00:00.000Z",
      }),
    );

    const beforeEvidence = selectBrowserVaultExperimentResults(client, slug, {
      asOf: "2026-04-14",
    });
    const afterEvidence = selectBrowserVaultExperimentResults(client, slug, {
      asOf: "2026-04-20",
    });

    assert.equal(beforeEvidence?.progress?.dataCoverage.status, "partial");
    assert.equal(afterEvidence?.progress?.dataCoverage.status, "ready_for_review");
  }
});

test("keeps multi-metric legacy summaries saved while pairing each metric with current bounded points", () => {
  const outcome = savedOutcome();
  const primaryMetric = outcome.metricResults[0];
  if (!primaryMetric) {
    throw new Error("Expected the saved outcome fixture to contain a metric.");
  }
  outcome.metricResults.push({
    ...primaryMetric,
    baseline: {
      daysWithData: 3,
      mean: 50,
      totalDays: 3,
      unit: "ms",
    },
    baselineMean: 50,
    biomarkerKey: "biomarker:hrv-rmssd",
    deltaAbs: 5,
    deltaPct: 10,
    expectedDirection: "increase",
    intervention: {
      daysWithData: 3,
      mean: 55,
      totalDays: 3,
      unit: "ms",
    },
    interventionMean: 55,
    label: "Heart rate variability",
    unit: "ms",
  });
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            desiredDirection: "increase",
            primaryBiomarkerKey: "biomarker:deep-sleep-minutes",
            measurementAnchors: [{
              role: "baseline",
              kind: "wearable_summary",
              recordId: "post-save-selector",
              biomarkerKeys: ["biomarker:deep-sleep-minutes"],
              observedOn: "2026-03-01",
            }],
          },
          endedOn: "2026-04-06",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
          status: "completed",
          runPlan: {
            baselineStart: "2026-03-01",
            baselineEnd: "2026-03-03",
            interventionStart: "2026-03-04",
            interventionEnd: "2026-03-06",
            logging: {
              sessionFields: ["estimated-sleep-onset-minutes"],
            },
            targetSessions: 3,
            minimumUsefulSessions: 2,
          },
        }),
      ],
      experimentOutcomes: [outcome],
      metricRows: [
        ...restingHeartRateRows([
          ["2026-04-01", 63],
          ["2026-04-02", 62],
          ["2026-04-03", 61],
          ["2026-04-04", 59],
          ["2026-04-05", 58],
          ["2026-04-06", 57],
          ["2026-04-07", 999],
        ]),
        ...[
          ["2026-04-01", 49],
          ["2026-04-02", 50],
          ["2026-04-03", 51],
          ["2026-04-04", 53],
          ["2026-04-05", 54],
          ["2026-04-06", 55],
        ].map(([date, value]) => metricRow({
          biomarkerKey: "biomarker:hrv-rmssd",
          date: String(date),
          metricKey: "hrv-rmssd",
          unit: "ms",
          value: Number(value),
        })),
        metricRow({
          biomarkerKey: "biomarker:deep-sleep-minutes",
          date: "2026-04-01",
          metricKey: "deep-sleep-minutes",
          unit: "minutes",
          value: 999,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.deepEqual(
    result?.biomarkers.map((biomarker) => ({
      baselineMean: biomarker.baseline.mean,
      biomarkerKey: biomarker.biomarkerKey,
      dates: biomarker.points.map((point) => point.date),
      interventionMean: biomarker.intervention.mean,
      values: biomarker.points.map((point) => point.value),
    })),
    [
      {
        baselineMean: 62,
        biomarkerKey: "biomarker:resting-heart-rate",
        dates: [
          "2026-04-01",
          "2026-04-02",
          "2026-04-03",
          "2026-04-04",
          "2026-04-05",
          "2026-04-06",
        ],
        interventionMean: 58,
        values: [63, 62, 61, 59, 58, 57],
      },
      {
        baselineMean: 50,
        biomarkerKey: "biomarker:hrv-rmssd",
        dates: [
          "2026-04-01",
          "2026-04-02",
          "2026-04-03",
          "2026-04-04",
          "2026-04-05",
          "2026-04-06",
        ],
        interventionMean: 55,
        values: [49, 50, 51, 53, 54, 55],
      },
    ],
  );
});

test("treats canonical completed runs with an early endedOn as stopped and clamps evidence", () => {
  const outcome = savedOutcome({
    windows: {
      baselineEnd: "2026-04-03",
      baselineStart: "2026-04-01",
      interventionEnd: "2026-04-10",
      interventionStart: "2026-04-04",
    },
  });
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          endedOn: "2026-04-05",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
          status: "paused",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-05",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 7,
            minimumUsefulSessions: 4,
          },
        }),
        sessionEvent("2026-04-04", "completed"),
        sessionEvent("2026-04-05", "completed"),
        sessionEvent("2026-04-06", "completed"),
        contextEvent("2026-04-07", {
          contextType: "travel",
          note: "This happened after the run stopped.",
          severity: "potential_confounder",
        }),
      ],
      experimentOutcomes: [outcome],
      generatedAt: "2026-04-20T12:00:00.000Z",
      metricRows: restingHeartRateRows([
        ["2026-04-01", 63],
        ["2026-04-02", 62],
        ["2026-04-03", 61],
        ["2026-04-04", 60],
        ["2026-04-05", 59],
        ["2026-04-06", 50],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.asOf, "2026-04-05");
  assert.equal(result.experiment.status, "paused");
  assert.equal(result.experiment.phase, "abandoned");
  assert.equal(result.experiment.windows.interventionEnd, "2026-04-05");
  assert.equal(result.progress?.phase, "abandoned");
  assert.equal(result.progress?.dayInRun, 5);
  assert.equal(result.savedOutcomeStatus, "not_expected");
  assert.equal(result.persistedOutcome, null);
  assert.equal(result.outcome, null);
  assert.deepEqual(
    result.biomarkers[0]?.points.map((point) => point.date),
    ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"],
  );
  assert.equal(result.progress?.adherence.completedSessions, 2);
  assert.equal(result.schedule?.completedSessions, 2);
  assert.equal(result.schedule?.cells.at(-1)?.localDate, "2026-04-05");
  assert.equal(result.context.length, 0);
});

test("excludes point-measurement anchors observed after an early stop", () => {
  const outcome = savedOutcome({
    windows: {
      baselineEnd: "2026-04-03",
      baselineStart: "2026-04-01",
      interventionEnd: "2026-04-10",
      interventionStart: "2026-04-04",
    },
  });
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            desiredDirection: "decrease",
            measurementAnchors: [
              {
                biomarkerKeys: ["biomarker:resting-heart-rate"],
                kind: "lab_panel",
                recordId: "evt_stopped_anchor_baseline",
                role: "baseline",
              },
              {
                biomarkerKeys: ["biomarker:resting-heart-rate"],
                kind: "lab_panel",
                recordId: "evt_stopped_anchor_followup",
                role: "followup",
              },
              {
                biomarkerKeys: ["biomarker:resting-heart-rate"],
                kind: "lab_panel",
                recordId: "evt_stopped_anchor_late",
                role: "followup",
              },
            ],
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
          },
          endedOn: "2026-04-05",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
          status: "abandoned",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-05",
          },
        }),
      ],
      experimentOutcomes: [outcome],
      generatedAt: "2026-04-20T12:00:00.000Z",
      metricRows: [
        metricRow({
          biomarkerKey: "biomarker:resting-heart-rate",
          date: "2026-04-02",
          metricKey: "resting-heart-rate",
          recordIds: ["evt_stopped_anchor_baseline"],
          sourceKind: "test-result",
          unit: "bpm",
          value: 63,
        }),
        metricRow({
          biomarkerKey: "biomarker:resting-heart-rate",
          date: "2026-04-05",
          metricKey: "resting-heart-rate",
          recordIds: ["evt_stopped_anchor_followup"],
          sourceKind: "test-result",
          unit: "bpm",
          value: 59,
        }),
        metricRow({
          biomarkerKey: "biomarker:resting-heart-rate",
          date: "2026-04-06",
          metricKey: "resting-heart-rate",
          recordIds: ["evt_stopped_anchor_late"],
          sourceKind: "test-result",
          unit: "bpm",
          value: 40,
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "abandoned");
  assert.equal(result.savedOutcomeStatus, "not_expected");
  assert.equal(result.persistedOutcome, null);
  assert.deepEqual(
    result.biomarkers[0]?.points.map((point) => point.date),
    ["2026-04-02", "2026-04-05"],
  );
  assert.equal(result.biomarkers[0]?.deltaAbs, -4);
  assert.equal(result.biomarkers[0]?.intervention.mean, 59);
});

test("projects suppressed-outcome stopped runs with live windows clamped to the stop date", () => {
  const outcome = savedOutcome({
    windows: {
      baselineEnd: "2026-04-03",
      baselineStart: "2026-04-01",
      interventionEnd: "2026-04-10",
      interventionStart: "2026-04-04",
    },
  });
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          endedOn: "2026-04-05",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
          status: "paused",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-04",
            interventionStart: "2026-04-05",
            interventionEnd: "2026-04-05",
          },
        }),
      ],
      experimentOutcomes: [outcome],
      generatedAt: "2026-04-20T12:00:00.000Z",
      metricRows: restingHeartRateRows([
        ["2026-04-02", 62],
        ["2026-04-04", 60],
        ["2026-04-05", 58],
        ["2026-04-06", 50],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "abandoned");
  assert.equal(result.persistedOutcome, null);
  assert.equal(result.experiment.windows.baselineStart, "2026-04-01");
  assert.equal(result.experiment.windows.baselineEnd, "2026-04-04");
  assert.equal(result.experiment.windows.interventionStart, "2026-04-05");
  assert.equal(result.experiment.windows.interventionEnd, "2026-04-05");
  assert.equal(result.biomarkers[0]?.baseline.mean, 61);
  assert.equal(result.biomarkers[0]?.intervention.mean, 58);
  assert.deepEqual(
    result.biomarkers[0]?.points.map((point) => point.date),
    ["2026-04-02", "2026-04-04", "2026-04-05"],
  );
});

test("fails closed on cross-run and stale outcome references", () => {
  const outcome = savedOutcome();
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          id: "exp_cold_plunge",
          outcomeRef: {
            generatedAt: outcome.generatedAt,
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
          slug: "cold-plunge-run",
          status: "completed",
        }),
        experimentEntity({
          outcomeRef: {
            generatedAt: "2027-01-01T00:00:00.000Z",
            outcomeId: outcome.outcomeId,
            relativePath: "bank/experiments/outcomes/outcome_exp_sauna.json",
          },
          status: "completed",
        }),
      ],
      experimentOutcomes: [outcome],
      generatedAt: "2026-04-20T12:00:00.000Z",
    }),
  );

  const crossRun = selectBrowserVaultExperimentResults(client, "cold-plunge-run");

  assert.ok(crossRun);
  assert.equal(crossRun.experiment.phase, "completed");
  assert.equal(crossRun.savedOutcomeStatus, "unavailable");
  assert.equal(crossRun.persistedOutcome, null);
  assert.equal(crossRun.outcome, null);

  const staleRef = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(staleRef);
  assert.equal(staleRef.experiment.phase, "completed");
  assert.equal(staleRef.savedOutcomeStatus, "unavailable");
  assert.equal(staleRef.persistedOutcome, null);
  assert.equal(staleRef.outcome, null);
});

test("keeps a stopped run stopped after a status edit even without a saved outcome", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          endedOn: "2026-04-05",
          status: "paused",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-10",
          },
        }),
      ],
      generatedAt: "2026-04-20T12:00:00.000Z",
      metricRows: restingHeartRateRows([
        ["2026-04-01", 63],
        ["2026-04-02", 62],
        ["2026-04-03", 61],
        ["2026-04-04", 60],
        ["2026-04-05", 59],
        ["2026-04-06", 50],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.asOf, "2026-04-05");
  assert.equal(result.experiment.phase, "abandoned");
  assert.equal(result.experiment.windows.interventionEnd, "2026-04-05");
  assert.equal(result.savedOutcomeStatus, "not_expected");
  assert.equal(result.persistedOutcome, null);
  assert.deepEqual(
    result.biomarkers[0]?.points.map((point) => point.date),
    ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"],
  );
});

test("keeps a completed run normal when endedOn equals the planned end", () => {
  const result = selectBrowserVaultExperimentResults(
    createBrowserVaultQueryClient(createReplica({
      entities: [experimentEntity({
        endedOn: "2026-04-06",
        status: "completed",
        runPlan: {
          baselineStart: "2026-04-01",
          baselineEnd: "2026-04-03",
          interventionStart: "2026-04-04",
          interventionEnd: "2026-04-06",
        },
      })],
      generatedAt: "2026-04-20T12:00:00.000Z",
    })),
    "finnish-sauna-run",
  );

  assert.equal(result?.experiment.phase, "completed");
  assert.equal(result?.savedOutcomeStatus, "pending");
});

test("does not manufacture a completed outcome when most sessions are assumed", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_assumed_outcome",
          slug: "browser-assumed-outcome",
          status: "completed",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
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
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_assumed_outcome",
          experimentSlug: "browser-assumed-outcome",
          id: "evt_browser_assumed_outcome_manual_1",
        }),
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_assumed_outcome",
          experimentSlug: "browser-assumed-outcome",
          id: "evt_browser_assumed_outcome_manual_2",
          occurredAt: "2026-04-04T15:00:00.000Z",
        }),
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

  const result = selectBrowserVaultExperimentResults(client, "browser-assumed-outcome");

  assert.equal(result?.progress?.adherence.completedSessions, 3);
  assert.equal(result?.progress?.adherence.confirmedSessions, 1);
  assert.equal(result?.progress?.adherence.assumedSessions, 2);
  assert.equal(result?.savedOutcomeStatus, "pending");
  assert.equal(result?.outcome, null);
});

test("counts repeated same-day browser adherence occurrences up to the planned count", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-05T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_repeated_occurrences",
          slug: "browser-repeated-occurrences",
          status: "active",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-04",
            modality: "strength-practice",
            targetSessions: 8,
            minimumUsefulSessions: 4,
            adherenceTargets: [
              {
                targetId: "strength-set",
                label: "Strength set",
                phase: "intervention",
                calendar: {
                  kind: "daily",
                  timeZone: "America/New_York",
                  targetCountPerDay: 8,
                },
                evidence: {
                  kind: "linkedEventCount",
                  eventKind: "intervention_session",
                  missing: "missed_after_grace",
                },
                grace: { hours: 0 },
                rollup: {
                  targetCompletions: 8,
                  minimumUsefulCompletions: 4,
                },
              },
            ],
          },
        }),
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_repeated_occurrences",
          experimentSlug: "browser-repeated-occurrences",
          id: "evt_browser_repeated_occurrence_1",
        }),
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_repeated_occurrences",
          experimentSlug: "browser-repeated-occurrences",
          id: "evt_browser_repeated_occurrence_2",
          occurredAt: "2026-04-04T15:00:00.000Z",
        }),
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_repeated_occurrences",
          experimentSlug: "browser-repeated-occurrences",
          id: "evt_browser_repeated_occurrence_3",
          occurredAt: "2026-04-04T17:00:00.000Z",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(
    client,
    "browser-repeated-occurrences",
  );

  assert.equal(result?.progress?.adherence.completedSessions, 3);
  assert.equal(result?.progress?.adherence.confirmedSessions, 3);
  assert.equal(result?.progress?.adherence.expectedSessionsByNow, 8);
  assert.equal(result?.progress?.adherence.loggedSessions, 3);
  assert.equal(result?.progress?.adherence.missedSessions, 5);
  assert.equal(result?.progress?.adherence.status, "behind");
});

test("does not make every repeated occurrence due before grace closes", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-04T16:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_repeated_before_grace",
          slug: "browser-repeated-before-grace",
          status: "active",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-04",
            modality: "strength-practice",
            targetSessions: 8,
            minimumUsefulSessions: 4,
            adherenceTargets: [
              {
                targetId: "strength-set",
                label: "Strength set",
                phase: "intervention",
                calendar: {
                  kind: "daily",
                  timeZone: "America/New_York",
                  localTime: "20:00",
                  targetCountPerDay: 8,
                },
                evidence: {
                  kind: "linkedEventCount",
                  eventKind: "intervention_session",
                  missing: "missed_after_grace",
                },
                grace: { hours: 4 },
                rollup: {
                  targetCompletions: 8,
                  minimumUsefulCompletions: 4,
                },
              },
            ],
          },
        }),
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_repeated_before_grace",
          experimentSlug: "browser-repeated-before-grace",
          id: "evt_browser_before_grace_1",
          occurredAt: "2026-04-04T13:00:00.000Z",
        }),
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_repeated_before_grace",
          experimentSlug: "browser-repeated-before-grace",
          id: "evt_browser_before_grace_2",
          occurredAt: "2026-04-04T14:00:00.000Z",
        }),
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_repeated_before_grace",
          experimentSlug: "browser-repeated-before-grace",
          id: "evt_browser_before_grace_3",
          occurredAt: "2026-04-04T15:00:00.000Z",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(
    client,
    "browser-repeated-before-grace",
  );

  assert.equal(result?.progress?.adherence.completedSessions, 3);
  assert.equal(result?.progress?.adherence.expectedSessionsByNow, 3);
  assert.equal(result?.progress?.adherence.loggedSessions, 3);
  assert.equal(result?.progress?.adherence.missedSessions, 0);
  assert.equal(result?.progress?.adherence.status, "on_track");
});

test("keeps completed live measurements separate from a not-yet-saved outcome", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_confirmed_outcome",
          slug: "browser-confirmed-outcome",
          status: "completed",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
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
        sessionEvent("2026-04-04", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_confirmed_outcome",
          experimentSlug: "browser-confirmed-outcome",
          id: "evt_browser_confirmed_outcome_1",
        }),
        sessionEvent("2026-04-05", "completed", {
          attributes: { source: "manual" },
          experimentId: "exp_browser_confirmed_outcome",
          experimentSlug: "browser-confirmed-outcome",
          id: "evt_browser_confirmed_outcome_2",
        }),
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

  const result = selectBrowserVaultExperimentResults(client, "browser-confirmed-outcome");

  assert.equal(result?.progress?.adherence.assumedSessions, 1);
  assert.equal(result?.progress?.adherence.confirmedSessions, 2);
  assert.equal(result?.savedOutcomeStatus, "pending");
  assert.equal(result?.outcome, null);
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
  assert.equal(result.savedOutcomeStatus, "pending");
  assert.equal(result.outcome, null);
});

test("keeps sparse finished measurements as context without inventing an outcome", () => {
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
  assert.equal(result.savedOutcomeStatus, "pending");
  assert.equal(result.outcome, null);
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
  assert.equal(result.schedule, null);
});

test("counts browser cycling adherence from provider ride activity sessions", () => {
  const slug = "cycling-block";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_cycling_block",
          slug,
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
        activitySessionEvent({
          activityType: "ride",
          date: "2026-06-02",
          id: "evt_ride_1",
          sportName: "Ride",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.equal(result?.progress?.adherence.completedSessions, 1);
  assert.equal(result?.progress?.adherence.loggedSessions, 1);
});

test("browser progress uses the protocol snapshot's accepted activity kinds", () => {
  const slug = "zone-2-block";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_zone_2_block",
          slug,
          commonsProtocolRef: {
            key: "protocol_variant:aerobic-base-training/zone-2-aerobic-base-block",
            pageRevisionId: "sha256:page",
            runSpecRevisionId: "sha256:run",
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
        activitySessionEvent({
          activityType: "Walking",
          date: "2026-06-01",
          durationMinutes: 40,
          id: "evt_zone_2_walk",
        }),
        activitySessionEvent({
          activityType: "Elliptical",
          date: "2026-06-02",
          durationMinutes: 45,
          id: "evt_zone_2_elliptical",
        }),
        activitySessionEvent({
          activityType: "Rowing",
          date: "2026-06-03",
          durationMinutes: 35,
          id: "evt_zone_2_row",
        }),
        activitySessionEvent({
          activityType: "Cycling",
          date: "2026-06-04",
          durationMinutes: 20,
          id: "evt_zone_2_short_ride",
        }),
        activitySessionEvent({
          activityType: "Running",
          date: "2026-06-05",
          durationMinutes: 50,
          id: "evt_zone_2_run",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.equal(result?.progress?.adherence.completedSessions, 3);
  assert.deepEqual(result?.adherence?.targets[0]?.evidence, {
    eventKind: "activity_session",
    activityKinds: ["walking", "cycling", "rowing", "elliptical"],
    kind: "linkedEventCount",
    minimumDurationMinutes: 35,
    missing: "missed_after_grace",
  });
});

test("counts browser generic workout modality from any activity sessions", () => {
  const slug = "generic-workout-block";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_generic_workout_block",
          slug,
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
        activitySessionEvent({ id: "evt_generic_workout_ride", date: "2026-06-02", activityType: "Cycling" }),
        activitySessionEvent({ id: "evt_generic_workout_strength", date: "2026-06-04", activityType: "Strength" }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });
  const evidence = result?.adherence?.targets[0]?.evidence;

  assert.ok(result);
  assert.equal(result.progress?.adherence.completedSessions, 2);
  assert.equal(result.progress?.adherence.loggedSessions, 2);
  assert.equal(evidence?.kind, "linkedEventCount");
  if (evidence?.kind === "linkedEventCount") {
    assert.equal(evidence.eventKind, "activity_session");
    assert.equal(evidence.activityKind, undefined);
  }
});

test("counts browser cardio category from running and swimming but not strength sessions", () => {
  const slug = "cardio-category-block";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-09T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_cardio_category_block",
          slug,
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
        activitySessionEvent({ id: "evt_cardio_run", date: "2026-06-01", activityType: "Running", source: "device" }),
        activitySessionEvent({ id: "evt_cardio_swim", date: "2026-06-03", activityType: "Swimming", source: "device" }),
        activitySessionEvent({ id: "evt_cardio_strength", date: "2026-06-04", activityType: "Strength" }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });
  const evidence = result?.adherence?.targets[0]?.evidence;

  assert.ok(result);
  assert.equal(result.progress?.adherence.completedSessions, 2);
  assert.equal(result.progress?.adherence.loggedSessions, 2);
  assert.equal(result.progress?.adherence.sensedSessions, 2);
  assert.equal(evidence?.kind, "linkedEventCount");
  if (evidence?.kind === "linkedEventCount") {
    assert.equal(evidence.eventKind, "activity_session");
    assert.equal(evidence.activityKind, "cardio");
  }
});

test("counts browser running adherence after replica skips generic activity type for nested sport", async () => {
  const slug = "nested-workout-run-block";
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "c".repeat(64),
    vault: createVaultReadModel({
      entities: [
        canonicalExperimentEntity({
          id: "exp_browser_nested_workout_run",
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
        canonicalActivitySessionEvent({
          activityType: "workout",
          date: "2026-06-02",
          id: "evt_browser_workout_run_1",
          workout: { sportName: "Run" },
        }),
      ],
      metadata: { title: "Browser nested workout adherence fixture" },
      vaultRoot: "browser://vault",
    }),
  });

  const projectedRun = replica.entities.find((entity) => entity.id === "evt_browser_workout_run_1");
  assert.deepEqual(projectedRun?.attributes, { activityKind: "run" });

  const client = createBrowserVaultQueryClient(replica);
  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.equal(result?.progress?.adherence.completedSessions, 1);
  assert.equal(result?.progress?.adherence.loggedSessions, 1);
});

test("ignores fully generic browser activity sessions for running adherence", async () => {
  const slug = "generic-workout-run-block";
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        canonicalExperimentEntity({
          id: "exp_browser_generic_workout_run",
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
        canonicalActivitySessionEvent({
          activityType: "workout",
          date: "2026-06-02",
          id: "evt_browser_generic_workout_1",
        }),
      ],
      metadata: { title: "Browser generic workout adherence fixture" },
      vaultRoot: "browser://vault",
    }),
  });

  const projectedWorkout = replica.entities.find((entity) => entity.id === "evt_browser_generic_workout_1");
  assert.deepEqual(projectedWorkout?.attributes, {});

  const client = createBrowserVaultQueryClient(replica);
  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.equal(result?.progress?.adherence.completedSessions, 0);
  assert.equal(result?.progress?.adherence.loggedSessions, 0);
});

test("ignores browser activity free-text names for running adherence", async () => {
  const slug = "free-text-workout-name-run-block";
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-09T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "e".repeat(64),
    vault: createVaultReadModel({
      entities: [
        canonicalExperimentEntity({
          id: "exp_browser_free_text_workout_run",
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
        canonicalActivitySessionEvent({
          activityType: "workout",
          date: "2026-06-02",
          id: "evt_browser_named_workout_1",
          name: "post run mobility",
          workout: { name: "post run mobility" },
        }),
        canonicalActivitySessionEvent({
          activityType: "workout",
          date: "2026-06-03",
          id: "evt_browser_structured_run_1",
          sportName: "Run",
        }),
      ],
      metadata: { title: "Browser free-text workout name adherence fixture" },
      vaultRoot: "browser://vault",
    }),
  });

  const projectedNamedWorkout = replica.entities.find((entity) => entity.id === "evt_browser_named_workout_1");
  assert.deepEqual(projectedNamedWorkout?.attributes, {});

  const client = createBrowserVaultQueryClient(replica);
  const result = selectBrowserVaultExperimentResults(client, { slug });

  assert.equal(result?.progress?.adherence.completedSessions, 1);
  assert.equal(result?.progress?.adherence.loggedSessions, 1);
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
  assert.equal(result.schedule, null);
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

for (const scenario of [
  {
    name: "prefers a same-date sensed run over a manual missed-wearable run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGA",
    slug: "browser-same-date-manual-device-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      sessionEvent("2026-06-01", "completed", {
        id: "evt_01JNV45RHN0TQ9ZXE0A7YSE4BA",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGA",
        experimentSlug: "browser-same-date-manual-device-run",
      }),
      activitySessionEvent({
        id: "evt_browser_same_date_device_run_1",
        date: "2026-06-01",
        activityType: "Running",
      }),
    ],
  },
  {
    name: "counts a surplus same-date done manual run beside one sensed run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGG",
    slug: "browser-same-date-surplus-manual-device-run",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      sessionEvent("2026-06-01", "completed", {
        id: "evt_browser_same_date_surplus_manual_run_1a",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGG",
        experimentSlug: "browser-same-date-surplus-manual-device-run",
        occurredAt: "2026-06-01T13:00:00.000Z",
      }),
      sessionEvent("2026-06-01", "completed", {
        id: "evt_browser_same_date_surplus_manual_run_1b",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGG",
        experimentSlug: "browser-same-date-surplus-manual-device-run",
        occurredAt: "2026-06-01T15:00:00.000Z",
      }),
      activitySessionEvent({
        id: "evt_browser_same_date_surplus_device_run_1",
        date: "2026-06-01",
        activityType: "Running",
      }),
    ],
  },
  {
    name: "lets two same-date sensed runs suppress two done manual rows",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGH",
    slug: "browser-same-date-two-manual-two-device-runs",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      sessionEvent("2026-06-01", "completed", {
        id: "evt_browser_same_date_pair_manual_run_1a",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGH",
        experimentSlug: "browser-same-date-two-manual-two-device-runs",
        occurredAt: "2026-06-01T13:00:00.000Z",
      }),
      sessionEvent("2026-06-01", "completed", {
        id: "evt_browser_same_date_pair_manual_run_1b",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGH",
        experimentSlug: "browser-same-date-two-manual-two-device-runs",
        occurredAt: "2026-06-01T15:00:00.000Z",
      }),
      activitySessionEvent({
        id: "evt_browser_same_date_pair_device_run_1a",
        date: "2026-06-01",
        activityType: "Running",
      }),
      activitySessionEvent({
        id: "evt_browser_same_date_pair_device_run_1b",
        date: "2026-06-01",
        activityType: "Run",
      }),
    ],
  },
  {
    name: "prefers a same-date device run over a manual activity run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGK",
    slug: "browser-same-date-manual-activity-device-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      activitySessionEvent({
        id: "evt_browser_same_date_manual_activity_run_1",
        date: "2026-06-01",
        activityType: "Running",
        source: "manual",
      }),
      activitySessionEvent({
        id: "evt_browser_same_date_device_activity_run_1",
        date: "2026-06-01",
        activityType: "Running",
        source: "device",
      }),
    ],
  },
  {
    name: "counts a manual activity run when it is the only evidence",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGP",
    slug: "browser-manual-activity-only-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      activitySessionEvent({
        id: "evt_browser_manual_activity_only_run_1",
        date: "2026-06-01",
        activityType: "Running",
        source: "manual",
      }),
    ],
  },
  {
    name: "suppresses only one non-device done row for one same-date device run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGM",
    slug: "browser-same-date-one-device-two-non-device-runs",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      activitySessionEvent({
        id: "evt_browser_one_device_two_non_device_manual_activity",
        date: "2026-06-01",
        activityType: "Running",
        source: "manual",
      }),
      sessionEvent("2026-06-01", "completed", {
        id: "evt_01JNV45RHN0TQ9ZXE0A7YSE3BM",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGM",
        experimentSlug: "browser-same-date-one-device-two-non-device-runs",
        occurredAt: "2026-06-01T15:00:00.000Z",
      }),
      activitySessionEvent({
        id: "evt_browser_one_device_two_non_device_device_activity",
        date: "2026-06-01",
        activityType: "Running",
        source: "device",
      }),
    ],
  },
  {
    name: "counts different-date manual and sensed runs separately",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGB",
    slug: "browser-different-date-manual-device-run",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      sessionEvent("2026-06-01", "completed", {
        id: "evt_01JNV45RHN0TQ9ZXE0A7YSE4BB",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGB",
        experimentSlug: "browser-different-date-manual-device-run",
      }),
      activitySessionEvent({
        id: "evt_browser_different_date_device_run_1",
        date: "2026-06-02",
        activityType: "Running",
      }),
    ],
  },
  {
    name: "counts two same-date sensed runs separately",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGC",
    slug: "browser-same-date-two-device-runs",
    modality: "Run",
    expectedCompletedSessions: 2,
    events: [
      activitySessionEvent({
        id: "evt_browser_same_date_device_run_2a",
        date: "2026-06-01",
        activityType: "Running",
      }),
      activitySessionEvent({
        id: "evt_browser_same_date_device_run_2b",
        date: "2026-06-01",
        activityType: "Run",
      }),
    ],
  },
  {
    name: "keeps a same-date missed manual annotation beside one sensed run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGI",
    slug: "browser-same-date-missed-manual-device-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    expectedMissedSessions: 1,
    events: [
      sessionEvent("2026-06-01", "missed", {
        id: "evt_browser_same_date_missed_manual_run_1",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGI",
        experimentSlug: "browser-same-date-missed-manual-device-run",
      }),
      activitySessionEvent({
        id: "evt_browser_same_date_missed_device_run_1",
        date: "2026-06-01",
        activityType: "Running",
      }),
    ],
  },
  {
    name: "keeps a manual-only missed-wearable run",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGD",
    slug: "browser-manual-only-device-run",
    modality: "Run",
    expectedCompletedSessions: 1,
    events: [
      sessionEvent("2026-06-01", "completed", {
        id: "evt_01JNV45RHN0TQ9ZXE0A7YSE4BC",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGD",
        experimentSlug: "browser-manual-only-device-run",
      }),
    ],
  },
  {
    name: "leaves non-sensable manual sauna logs unchanged",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGE",
    slug: "browser-manual-sauna-unchanged",
    modality: "sauna",
    expectedCompletedSessions: 1,
    events: [
      sessionEvent("2026-06-01", "completed", {
        id: "evt_01JNV45RHN0TQ9ZXE0A7YSE4BD",
        experimentId: "exp_01JNV4458HYPP53JDQCBP1QKGE",
        experimentSlug: "browser-manual-sauna-unchanged",
      }),
      activitySessionEvent({
        id: "evt_browser_manual_sauna_device_run_ignored",
        date: "2026-06-01",
        activityType: "Running",
      }),
    ],
  },
] satisfies Array<{
  events: BrowserVaultEntity[];
  expectedCompletedSessions: number;
  expectedMissedSessions?: number;
  experimentId: string;
  modality: string;
  name: string;
  slug: string;
}>) {
  test(`counts browser adherence when it ${scenario.name}`, () => {
    const client = createBrowserVaultQueryClient(
      createReplica({
        generatedAt: "2026-06-09T12:00:00.000Z",
        entities: [
          experimentEntity({
            id: scenario.experimentId,
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
      }),
    );

    const result = selectBrowserVaultExperimentResults(client, { slug: scenario.slug });

    assert.equal(result?.progress?.adherence.completedSessions, scenario.expectedCompletedSessions);
    assert.equal(result?.progress?.adherence.loggedSessions, scenario.expectedCompletedSessions);
    assert.equal(result?.progress?.adherence.missedSessions ?? 0, scenario.expectedMissedSessions ?? 0);
  });
}

test("browser adherence calendar suppresses same-date manual fallback when a sensed run matches", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QKGF";
  const slug = "browser-calendar-same-date-manual-device-run";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-03T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: experimentId,
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
        sessionEvent("2026-06-01", "completed", {
          id: "evt_01JNV45RHN0TQ9ZXE0A7YSE4BE",
          experimentId,
          experimentSlug: slug,
        }),
        activitySessionEvent({
          id: "evt_browser_calendar_same_date_device_run_1",
          date: "2026-06-01",
          activityType: "Running",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });
  const cell = result?.schedule?.cells.find((entry) => entry.localDate === "2026-06-01");

  assert.equal(result?.schedule?.completedSessions, 1);
  assert.deepEqual(cell?.evidenceIds, ["evt_browser_calendar_same_date_device_run_1"]);
});

test("browser adherence calendar suppresses same-date manual activity when a device run matches", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QKGN";
  const slug = "browser-calendar-same-date-manual-activity-device-run";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-03T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: experimentId,
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
        activitySessionEvent({
          id: "evt_browser_calendar_same_date_manual_activity_run_1",
          date: "2026-06-01",
          activityType: "Running",
          source: "manual",
        }),
        activitySessionEvent({
          id: "evt_browser_calendar_same_date_device_activity_run_1",
          date: "2026-06-01",
          activityType: "Running",
          source: "device",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });
  const cell = result?.schedule?.cells.find((entry) => entry.localDate === "2026-06-01");

  assert.equal(result?.schedule?.completedSessions, 1);
  assert.deepEqual(cell?.evidenceIds, ["evt_browser_calendar_same_date_device_activity_run_1"]);
});

test("browser adherence calendar keeps surplus same-date manual evidence after one sensed run", () => {
  const experimentId = "exp_01JNV4458HYPP53JDQCBP1QKGJ";
  const slug = "browser-calendar-same-date-surplus-manual-device-run";
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-03T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: experimentId,
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
        sessionEvent("2026-06-01", "completed", {
          id: "evt_browser_calendar_surplus_manual_run_1a",
          experimentId,
          experimentSlug: slug,
          occurredAt: "2026-06-01T13:00:00.000Z",
        }),
        sessionEvent("2026-06-01", "completed", {
          id: "evt_browser_calendar_surplus_manual_run_1b",
          experimentId,
          experimentSlug: slug,
          occurredAt: "2026-06-01T15:00:00.000Z",
        }),
        activitySessionEvent({
          id: "evt_browser_calendar_surplus_device_run_1",
          date: "2026-06-01",
          activityType: "Running",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, { slug });
  const cell = result?.schedule?.cells.find((entry) => entry.localDate === "2026-06-01");

  assert.equal(cell?.kind, "completed");
  assert.deepEqual(cell?.evidenceIds, [
    "evt_browser_calendar_surplus_manual_run_1b",
    "evt_browser_calendar_surplus_device_run_1",
  ]);
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

test("browser cardio category rejects explicitly contradictory intervention sessions only", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-06-05T12:00:00.000Z",
      entities: [
        experimentEntity({
          id: "exp_browser_cardio_interventions",
          slug: "browser-cardio-intervention-kind-scope",
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
                  { localDate: "2026-06-04" },
                ],
              },
              evidence: {
                kind: "linkedEventCount",
                eventKind: "activity_session",
                activityKind: "cardio",
                missing: "missed_after_grace",
              },
              rollup: {
                targetCompletions: 4,
                minimumUsefulCompletions: 3,
              },
            }],
          },
        }),
        sessionEvent("2026-06-01", "completed", {
          attributes: {
            interventionType: "strength",
          },
          experimentId: "exp_browser_cardio_interventions",
          experimentSlug: "browser-cardio-intervention-kind-scope",
          id: "evt_browser_cardio_strength_intervention",
        }),
        sessionEvent("2026-06-02", "completed", {
          experimentId: "exp_browser_cardio_interventions",
          experimentSlug: "browser-cardio-intervention-kind-scope",
          id: "evt_browser_cardio_kindless_intervention",
        }),
        sessionEvent("2026-06-03", "completed", {
          attributes: {
            interventionType: "running",
          },
          experimentId: "exp_browser_cardio_interventions",
          experimentSlug: "browser-cardio-intervention-kind-scope",
          id: "evt_browser_cardio_running_intervention",
        }),
        sessionEvent("2026-06-04", "completed", {
          attributes: {
            interventionType: "hiit",
          },
          experimentId: "exp_browser_cardio_interventions",
          experimentSlug: "browser-cardio-intervention-kind-scope",
          id: "evt_browser_cardio_hiit_intervention",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "browser-cardio-intervention-kind-scope");

  assert.ok(result);
  assert.equal(result.progress?.adherence.completedSessions, 3);
  assert.equal(result.progress?.adherence.loggedSessions, 3);
  assert.deepEqual(
    result.schedule?.cells.map((cell) => [cell.localDate, cell.kind, cell.evidenceIds]),
    [
      ["2026-06-01", "missed", []],
      ["2026-06-02", "completed", ["evt_browser_cardio_kindless_intervention"]],
      ["2026-06-03", "completed", ["evt_browser_cardio_running_intervention"]],
      ["2026-06-04", "completed", ["evt_browser_cardio_hiit_intervention"]],
    ],
  );
});

test("browser cardio category rejects contradictory interventionType through the real replica", async () => {
  const experimentId = "exp_browser_real_cardio_intervention_type";
  const slug = "browser-real-cardio-intervention-type";
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-05T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "c".repeat(64),
    vault: createVaultReadModel({
      entities: [
        canonicalExperimentEntity({
          id: experimentId,
          slug,
          runPlan: {
            baselineStart: "2026-05-25",
            baselineEnd: "2026-05-31",
            interventionStart: "2026-06-01",
            interventionEnd: "2026-06-01",
            adherenceTargets: [{
              targetId: "cardio",
              label: "Cardio",
              phase: "intervention",
              calendar: {
                kind: "explicitDates",
                timeZone: "America/New_York",
                dates: [{ localDate: "2026-06-01" }],
              },
              evidence: {
                kind: "linkedEventCount",
                eventKind: "activity_session",
                activityKind: "cardio",
                missing: "missed_after_grace",
              },
            }],
          },
        }),
        canonicalInterventionSessionEvent({
          date: "2026-06-01",
          experimentId,
          experimentSlug: slug,
          id: "evt_browser_real_strength_intervention",
          interventionType: "strength",
        }),
      ],
      metadata: { title: "Browser intervention type fixture" },
      vaultRoot: "browser://vault",
    }),
  });

  const projectedSession = replica.entities.find((entity) =>
    entity.id === "evt_browser_real_strength_intervention"
  );
  assert.equal(projectedSession?.attributes.interventionType, "strength");

  const result = selectBrowserVaultExperimentResults(createBrowserVaultQueryClient(replica), { slug });

  assert.ok(result);
  assert.equal(result.progress?.adherence.completedSessions, 0);
  assert.equal(result.progress?.adherence.loggedSessions, 0);
  assert.deepEqual(
    result.schedule?.cells.map((cell) => [cell.localDate, cell.kind, cell.evidenceIds]),
    [["2026-06-01", "missed", []]],
  );
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

test("keeps completed lab anchor comparisons pending until an outcome is saved", () => {
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
  assert.equal(result.savedOutcomeStatus, "pending");
  assert.equal(result.outcome, null);
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
  name?: string;
  source?: string;
  sportName?: string;
  workout?: Record<string, unknown>;
}): CanonicalEntity {
  return {
    attributes: {
      activityType: input.activityType,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.sportName === undefined ? {} : { sportName: input.sportName }),
      ...(input.workout === undefined ? {} : { workout: input.workout }),
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

function canonicalInterventionSessionEvent(input: {
  date: string;
  experimentId: string;
  experimentSlug: string;
  id: string;
  interventionType?: string;
  sessionStatus?: string;
}): CanonicalEntity {
  return {
    attributes: {
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug,
      ...(input.interventionType === undefined
        ? {}
        : { interventionType: input.interventionType }),
      sessionLocalDate: input.date,
      sessionStatus: input.sessionStatus ?? "completed",
    },
    body: null,
    date: input.date,
    entityId: input.id,
    experimentSlug: input.experimentSlug,
    family: "event",
    frontmatter: null,
    kind: "intervention_session",
    links: [{ targetId: input.experimentId, type: "related_to" }],
    lookupIds: [input.id],
    occurredAt: `${input.date}T13:00:00.000Z`,
    path: "ledger/events/2026/2026-06.jsonl",
    primaryLookupId: input.id,
    recordClass: "ledger",
    relatedIds: [input.experimentId],
    status: null,
    stream: null,
    tags: [],
    title: "Intervention session",
  } satisfies CanonicalEntity;
}

function createReplica(input: {
  entities?: BrowserVaultEntity[];
  experimentOutcomes?: ExperimentOutcome[];
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
    experimentOutcomes: input.experimentOutcomes ?? [],
    generatedAt: input.generatedAt ?? "2026-04-10T12:00:00.000Z",
    labResultRows: [],
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

function savedOutcome(input: {
  confidence?: ExperimentOutcome["confidence"];
  generatedAt?: string;
  id?: string;
  points?: ExperimentOutcome["metricResults"][number]["points"];
  schemaVersion?: ExperimentOutcome["schemaVersion"];
  slug?: string;
  windows?: ExperimentOutcome["windows"];
} = {}): ExperimentOutcome {
  const id = input.id ?? "exp_sauna";
  const slug = input.slug ?? "finnish-sauna-run";
  const windows = input.windows ?? {
    baselineEnd: "2026-04-03",
    baselineStart: "2026-04-01",
    interventionEnd: "2026-04-06",
    interventionStart: "2026-04-04",
  };

  return {
    adherenceSummary: {
      adherenceLevel: "good",
      completedSessions: 3,
      minimumUsefulSessions: 2,
      status: "met_target",
      targetSessions: 3,
    },
    asOf: windows.interventionEnd ?? "2026-04-06",
    commonsProtocolRef: {
      key: "protocol:finnish-sauna",
      pageRevisionId: "sha256:page",
      runSpecRevisionId: "sha256:run",
      testPlanId: "rhr-21d",
    },
    conclusion: {
      caveats: ["Travel overlapped the final two sessions."],
      headline: "The saved outcome headline",
      plainLanguage: "This is the exact saved plain-language conclusion.",
    },
    confidence: input.confidence ?? {
      level: "medium",
      reasons: ["The saved analysis accounted for a travel confounder."],
    },
    confounders: ["Travel"],
    effectiveProtocolSnapshot: null,
    experiment: {
      id,
      slug,
      status: "completed",
      title: "Finnish sauna run",
    },
    generatedAt: input.generatedAt ?? "2026-04-07T12:00:00.000Z",
    metricResults: [{
      baseline: {
        daysWithData: 3,
        mean: 62,
        totalDays: 3,
        unit: "bpm",
      },
      baselineDayCount: 3,
      baselineMean: 62,
      biomarkerKey: "biomarker:resting-heart-rate",
      completeness: "good",
      deltaAbs: -4,
      deltaPct: -6.45,
      expectedDirection: "decrease",
      intervention: {
        daysWithData: 3,
        mean: 58,
        totalDays: 3,
        unit: "bpm",
      },
      interventionDayCount: 3,
      interventionMean: 58,
      label: "Resting heart rate",
      movedAsExpected: true,
      ...(input.points === undefined ? {} : { points: input.points }),
      unit: "bpm",
    }],
    outcomeId: `outcome_${id}`,
    protocolRef: null,
    schemaVersion: input.schemaVersion ?? "murph.experiment-outcome.v1",
    windows,
  };
}

function experimentEntity(input: {
  analysisPlan?: Record<string, unknown>;
  commonsProtocolRef?: Record<string, unknown>;
  effectiveProtocolSnapshot?: Record<string, unknown>;
  endedOn?: string;
  expectedSignalDescriptions?: unknown[];
  id?: string;
  omitRunPlan?: boolean;
  occurredAt?: string;
  outcomeRef?: Record<string, unknown>;
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
      commonsProtocolRef: input.commonsProtocolRef ?? {
        key: "protocol:finnish-sauna",
        pageRevisionId: "sha256:page",
        runSpecRevisionId: "sha256:run",
        testPlanId: "rhr-21d",
      },
      ...(input.effectiveProtocolSnapshot
        ? { effectiveProtocolSnapshot: input.effectiveProtocolSnapshot }
        : {}),
      expectedSignalDescriptions: input.expectedSignalDescriptions,
      ...(input.endedOn ? { endedOn: input.endedOn } : {}),
      experimentId: id,
      ...(input.outcomeRef ? { outcomeRef: input.outcomeRef } : {}),
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

function structuredReviewEvidenceEntity(input: {
  date: string;
  id: string;
  slug: string;
}): BrowserVaultEntity {
  return {
    attributes: {
      experimentSlug: input.slug,
    },
    bodyPreview: null,
    date: input.date,
    experimentSlug: input.slug,
    family: "event",
    id: input.id,
    kind: "document",
    links: [],
    lookupIds: [input.id],
    occurredAt: `${input.date}T12:00:00.000Z`,
    recordClass: "ledger",
    status: null,
    stream: null,
    tags: [],
    title: "Structured review evidence",
  };
}

function activitySessionEvent(input: {
  activityType: string;
  date: string;
  durationMinutes?: number;
  id: string;
  occurredAt?: string;
  source?: string;
  sportName?: string;
  title?: string;
}): BrowserVaultEntity {
  return {
    attributes: {
      activityType: input.activityType,
      ...(input.durationMinutes === undefined
        ? {}
        : { durationMinutes: input.durationMinutes }),
      ...(input.source === undefined ? {} : { source: input.source }),
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
