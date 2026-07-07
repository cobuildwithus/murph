import assert from "node:assert/strict";

import type { ExperimentAdherenceTarget } from "@murphai/contracts";
import { test } from "vitest";

import {
  buildExperimentAdherenceCalendar,
  countCompletedAdherenceSessions,
  resolveAdherenceEvidence,
  synthesizeLegacySessionAdherenceTargets,
} from "../src/experiment-adherence.ts";

const windows = {
  baselineStart: "2026-04-01",
  baselineEnd: "2026-04-07",
  interventionStart: "2026-04-08",
  interventionEnd: "2026-04-12",
};

test("evaluates daily linked-event adherence without creating unplanned cells", () => {
  const target: ExperimentAdherenceTarget = {
    targetId: "sauna",
    label: "Sauna",
    phase: "intervention",
    calendar: {
      kind: "daily",
      timeZone: "America/New_York",
      targetCountPerDay: 1,
    },
    evidence: {
      kind: "linkedEventCount",
      eventKind: "intervention_session",
      missing: "missed_after_grace",
    },
    grace: { hours: 0 },
  };

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-11T12:00:00.000Z",
    observations: [
      {
        evidenceId: "evt_1",
        eventKind: "intervention_session",
        localDate: "2026-04-08",
        status: "completed",
      },
      {
        evidenceId: "evt_off_plan",
        eventKind: "intervention_session",
        localDate: "2026-04-20",
        status: "completed",
      },
    ],
    targets: [target],
    windows,
  });

  assert.deepEqual(
    result.cells.map((cell) => [cell.localDate, cell.status]),
    [
      ["2026-04-08", "satisfied"],
      ["2026-04-09", "missed"],
      ["2026-04-10", "missed"],
      ["2026-04-11", "scheduled"],
      ["2026-04-12", "scheduled"],
    ],
  );
  assert.equal(result.cells.some((cell) => cell.localDate === "2026-04-20"), false);
});

test("supports day-level target counts for partial adherence", () => {
  const target: ExperimentAdherenceTarget = {
    targetId: "psyllium",
    label: "Psyllium",
    phase: "intervention",
    calendar: {
      kind: "daily",
      timeZone: "America/New_York",
      targetCountPerDay: 2,
    },
    evidence: {
      kind: "linkedEventCount",
      eventKind: "supplement_intake",
      missing: "missed_after_grace",
    },
    grace: { hours: 0 },
  };

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-10T12:00:00.000Z",
    observations: [
      {
        evidenceId: "evt_1",
        eventKind: "supplement_intake",
        localDate: "2026-04-08",
        status: "completed",
      },
      {
        evidenceId: "evt_2",
        eventKind: "supplement_intake",
        localDate: "2026-04-09",
        status: "completed",
      },
      {
        evidenceId: "evt_3",
        eventKind: "supplement_intake",
        localDate: "2026-04-09",
        status: "completed",
      },
    ],
    targets: [target],
    windows,
  });

  assert.deepEqual(
    result.cells.slice(0, 3).map((cell) => [
      cell.localDate,
      cell.status,
      cell.observedCount,
      cell.expectedCount,
    ]),
    [
      ["2026-04-08", "partial", 1, 2],
      ["2026-04-09", "satisfied", 2, 2],
      ["2026-04-10", "scheduled", 0, 2],
    ],
  );
});

test("treats explicitly skipped linked-event adherence as missed in v1", () => {
  const target: ExperimentAdherenceTarget = {
    targetId: "sauna",
    label: "Sauna",
    phase: "intervention",
    calendar: {
      kind: "daily",
      timeZone: "America/New_York",
      targetCountPerDay: 1,
    },
    evidence: {
      kind: "linkedEventCount",
      eventKind: "intervention_session",
      missing: "missed_after_grace",
    },
    grace: { hours: 24 },
  };

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-11T12:00:00.000Z",
    observations: [{
      evidenceId: "evt_skipped",
      eventKind: "intervention_session",
      localDate: "2026-04-10",
      status: "skipped",
    }],
    targets: [target],
    windows,
  });

  const skippedCell = result.cells.find((cell) => cell.localDate === "2026-04-10");
  assert.equal(skippedCell?.status, "missed");
  assert.deepEqual(skippedCell?.evidenceIds, ["evt_skipped"]);
});

test("assumes missing non-sensable linked-event adherence after grace", () => {
  const target: ExperimentAdherenceTarget = {
    targetId: "sauna",
    label: "Sauna",
    phase: "intervention",
    calendar: {
      kind: "daily",
      timeZone: "America/New_York",
      targetCountPerDay: 1,
    },
    evidence: {
      kind: "linkedEventCount",
      eventKind: "intervention_session",
      missing: "assumed_after_grace",
    },
    grace: { hours: 24 },
  };

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-11T12:00:00.000Z",
    observations: [{
      evidenceId: "evt_skipped",
      eventKind: "intervention_session",
      localDate: "2026-04-08",
      status: "skipped",
    }],
    targets: [target],
    windows,
  });

  assert.deepEqual(
    result.cells.slice(0, 4).map((cell) => [cell.localDate, cell.status, cell.score, cell.reason]),
    [
      ["2026-04-08", "missed", 0, "Target evidence was marked missed."],
      ["2026-04-09", "assumed", 1, "No log needed. Assumed done on schedule."],
      ["2026-04-10", "scheduled", null, "The planned target is not due yet."],
      ["2026-04-11", "scheduled", null, "The planned target is not due yet."],
    ],
  );
  assert.equal(result.summary.status, "behind");
  assert.equal(result.targets[0]?.assumedCount, 1);
});

test("grades stale activity assumed-after-grace targets as missed", () => {
  const target: ExperimentAdherenceTarget = {
    targetId: "running",
    label: "Running",
    phase: "intervention",
    calendar: {
      kind: "daily",
      timeZone: "America/New_York",
      targetCountPerDay: 1,
    },
    evidence: {
      kind: "linkedEventCount",
      eventKind: "activity_session",
      activityKind: "running",
      missing: "assumed_after_grace",
    },
    grace: { hours: 0 },
  };

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-11T12:00:00.000Z",
    observations: [],
    targets: [target],
    windows,
  });

  const missedCell = result.cells.find((cell) => cell.localDate === "2026-04-10");
  assert.equal(missedCell?.status, "missed");
  assert.equal(missedCell?.score, 0);
  assert.equal(missedCell?.reason, "No target evidence was logged after the grace window.");
  assert.equal(result.targets[0]?.assumedCount, 0);
  assert.equal(result.targets[0]?.missedCount, 3);
});

test("keeps missing metric-threshold evidence unknown when configured that way", () => {
  const target: ExperimentAdherenceTarget = {
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
    grace: { hours: 0 },
  };

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-10T12:00:00.000Z",
    observations: [
      {
        evidenceId: "metric_1",
        localDate: "2026-04-08",
        metricKey: "steps",
        value: 9100,
      },
      {
        evidenceId: "metric_2",
        localDate: "2026-04-09",
        metricKey: "steps",
        value: 4000,
      },
      {
        evidenceId: "metric_3",
        localDate: "2026-04-09",
        metricKey: "steps",
        value: 8300,
      },
    ],
    targets: [target],
    windows,
  });

  assert.deepEqual(
    result.cells.slice(0, 3).map((cell) => [cell.localDate, cell.status]),
    [
      ["2026-04-08", "satisfied"],
      ["2026-04-09", "satisfied"],
      ["2026-04-10", "scheduled"],
    ],
  );
});

test("synthesizes legacy schedules into adherence targets", () => {
  const targets = synthesizeLegacySessionAdherenceTargets({
    runPlan: {
      modality: "Sauna",
      schedule: {
        kind: "cron",
        expression: "0 8 * * 2,4",
        timeZone: "America/New_York",
      },
      targetSessions: 2,
      minimumUsefulSessions: 1,
    },
  });

  assert.equal(targets[0]?.targetId, "sauna");
  assert.deepEqual(targets[0]?.calendar, {
    kind: "weekdays",
    timeZone: "America/New_York",
    localTime: "08:00",
    weekdays: [2, 4],
    targetCountPerDay: 1,
  });
  assert.deepEqual(targets[0]?.rollup, {
    targetCompletions: 2,
    minimumUsefulCompletions: 1,
  });
  assert.deepEqual(targets[0]?.evidence, {
    kind: "linkedEventCount",
    eventKind: "intervention_session",
    missing: "assumed_after_grace",
  });
});

test("synthesizes calendar-less count targets from legacy session counts", () => {
  const targets = synthesizeLegacySessionAdherenceTargets({
    runPlan: {
      modality: "Supplement",
      sessionsPerWeek: 7,
      targetSessions: 28,
      minimumUsefulSessions: 20,
    } as const,
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.calendar, undefined);
  assert.deepEqual(targets[0]?.evidence, {
    kind: "linkedEventCount",
    eventKind: "intervention_session",
    missing: "missed_after_grace",
  });
  assert.deepEqual(targets[0]?.rollup, {
    targetCompletions: 28,
    minimumUsefulCompletions: 20,
  });

  const result = buildExperimentAdherenceCalendar({
    asOf: "2026-04-10T12:00:00.000Z",
    targets,
    windows,
  });
  assert.equal(result.cells.length, 0);
  assert.equal(result.targets[0]?.plannedCount, 0);
});

test("synthesizes device-observable count targets with activity evidence", () => {
  const targets = synthesizeLegacySessionAdherenceTargets({
    runPlan: {
      modality: "Run",
      targetSessions: 24,
      minimumUsefulSessions: 12,
    },
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.calendar, undefined);
  assert.deepEqual(targets[0]?.evidence, {
    kind: "linkedEventCount",
    eventKind: "activity_session",
    activityKind: "running",
    missing: "missed_after_grace",
  });
  assert.deepEqual(targets[0]?.rollup, {
    targetCompletions: 24,
    minimumUsefulCompletions: 12,
  });
});

test("maps generic workout modalities to unscoped activity evidence", () => {
  assert.deepEqual(resolveAdherenceEvidence("Workout"), {
    eventKind: "activity_session",
  });
  assert.deepEqual(resolveAdherenceEvidence("cardio"), {
    eventKind: "activity_session",
    activityKind: "cardio",
  });
  assert.deepEqual(resolveAdherenceEvidence("movement"), {
    eventKind: "intervention_session",
  });
  assert.deepEqual(resolveAdherenceEvidence("activity"), {
    eventKind: "intervention_session",
  });
  assert.deepEqual(resolveAdherenceEvidence("sauna"), {
    eventKind: "intervention_session",
  });

  const targets = synthesizeLegacySessionAdherenceTargets({
    runPlan: {
      modality: "Workout",
      targetSessions: 3,
      minimumUsefulSessions: 2,
    },
  });

  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0]?.evidence, {
    kind: "linkedEventCount",
    eventKind: "activity_session",
    missing: "missed_after_grace",
  });

  for (const modality of ["movement", "activity"]) {
    const manualTargets = synthesizeLegacySessionAdherenceTargets({
      runPlan: {
        modality,
        targetSessions: 3,
        minimumUsefulSessions: 2,
      },
    });

    assert.deepEqual(manualTargets[0]?.evidence, {
      kind: "linkedEventCount",
      eventKind: "intervention_session",
      missing: "missed_after_grace",
    });
  }
});

test("synthesizes count-less run-plan targets without rollup metadata", () => {
  const targets = synthesizeLegacySessionAdherenceTargets({
    runPlan: {
      modality: "Run",
    },
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.calendar, undefined);
  assert.equal(targets[0]?.rollup, undefined);
  assert.deepEqual(targets[0]?.evidence, {
    kind: "linkedEventCount",
    eventKind: "activity_session",
    activityKind: "running",
    missing: "missed_after_grace",
  });
});

test("counts calendar-less activity targets by matching activity kind", () => {
  const target: ExperimentAdherenceTarget = {
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
      targetCompletions: 24,
    },
  };

  const counts = countCompletedAdherenceSessions({
    asOfDate: "2026-04-12",
    observations: [
      { evidenceId: "run_1", eventKind: "activity_session", activityKind: "running", localDate: "2026-04-08" },
      { evidenceId: "run_2", eventKind: "activity_session", activityKind: "morning-run", localDate: "2026-04-09" },
      { evidenceId: "run_3", eventKind: "activity_session", activityKind: "run", localDate: "2026-04-10" },
      { evidenceId: "run_4", eventKind: "activity_session", activityKind: "trail-running", localDate: "2026-04-11" },
      { evidenceId: "ride_1", eventKind: "activity_session", activityKind: "cycling", localDate: "2026-04-08" },
      { evidenceId: "walk_1", eventKind: "activity_session", activityKind: "walking", localDate: "2026-04-09" },
      { evidenceId: "strength_1", eventKind: "activity_session", activityKind: "strength", localDate: "2026-04-10" },
    ],
    target,
    windows,
  });

  assert.equal(counts.completedSessions, 4);
});

test("counts cardio category activity targets from member activity kinds only", () => {
  const target: ExperimentAdherenceTarget = {
    targetId: "cardio",
    label: "Cardio",
    phase: "intervention",
    evidence: {
      kind: "linkedEventCount",
      eventKind: "activity_session",
      activityKind: "cardio",
      missing: "missed_after_grace",
    },
  };

  const counts = countCompletedAdherenceSessions({
    asOfDate: "2026-04-12",
    observations: [
      { evidenceId: "run_1", eventKind: "activity_session", activityKind: "running", localDate: "2026-04-08" },
      { evidenceId: "swim_1", eventKind: "activity_session", activityKind: "swimming", localDate: "2026-04-09" },
      { evidenceId: "strength_1", eventKind: "activity_session", activityKind: "strength", localDate: "2026-04-10" },
    ],
    target,
    windows,
  });

  assert.equal(counts.completedSessions, 2);
});


test("rejects adherence calendars that expand beyond the browser-safe cell limit", () => {
  const target: ExperimentAdherenceTarget = {
    targetId: "daily",
    label: "Daily",
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
  };

  assert.throws(
    () => buildExperimentAdherenceCalendar({
      asOf: "2026-04-01T00:00:00.000Z",
      targets: [target],
      windows: {
        baselineEnd: null,
        baselineStart: null,
        interventionStart: "2020-01-01",
        interventionEnd: "2035-01-01",
      },
    }),
    /cell limit/u,
  );
});
