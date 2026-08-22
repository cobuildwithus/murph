import assert from "node:assert/strict";

import type { ExperimentAdherenceTarget } from "@murphai/contracts";
import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import {
  buildExperimentAdherenceCalendar,
  countCalendarAdherenceSessions,
  synthesizeLegacySessionAdherenceTargets,
  type ExperimentAdherenceObservation,
} from "../src/experiment-adherence.ts";
import { summarizeExperimentProgress } from "../src/experiments.ts";
import { createVaultReadModel } from "../src/model.ts";

const EXPERIMENT_ID = "exp_01JNV4458HYPP53JDQCBP1QJFM";
const EXPERIMENT_SLUG = "repeated-strength";

function makeEntity(
  overrides: Partial<CanonicalEntity> &
    Pick<CanonicalEntity, "entityId" | "family" | "kind" | "recordClass">,
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

function repeatedTarget(input: {
  graceHours?: number;
  localTime?: string;
  missing: "assumed_after_grace" | "missed_after_grace" | "unknown";
  targetCountPerDay?: number;
}): ExperimentAdherenceTarget {
  const targetCountPerDay = input.targetCountPerDay ?? 8;
  return {
    targetId: "strength-set",
    label: "Strength set",
    phase: "intervention",
    calendar: {
      kind: "daily",
      timeZone: "UTC",
      ...(input.localTime ? { localTime: input.localTime } : {}),
      targetCountPerDay,
    },
    evidence: {
      kind: "linkedEventCount",
      eventKind: "intervention_session",
      missing: input.missing,
    },
    grace: { hours: input.graceHours ?? 0 },
    rollup: {
      targetCompletions: targetCountPerDay,
      minimumUsefulCompletions: Math.max(1, Math.floor(targetCountPerDay / 2)),
    },
  };
}

function makeExperiment(input: {
  missing: "assumed_after_grace" | "missed_after_grace";
  targetCountPerDay?: number;
}): CanonicalEntity {
  const target = repeatedTarget(input);
  const targetCountPerDay = input.targetCountPerDay ?? 8;
  return makeEntity({
    entityId: EXPERIMENT_ID,
    family: "experiment",
    kind: "experiment_entry",
    recordClass: "bank",
    occurredAt: "2026-08-01T08:00:00.000Z",
    date: "2026-08-01",
    experimentSlug: EXPERIMENT_SLUG,
    status: "active",
    title: "Repeated strength",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId: EXPERIMENT_ID,
      slug: EXPERIMENT_SLUG,
      title: "Repeated strength",
      status: "active",
      startedOn: "2026-08-01",
      runPlan: {
        interventionStart: "2026-08-01",
        interventionEnd: "2026-08-01",
        modality: "strength-practice",
        targetSessions: targetCountPerDay,
        minimumUsefulSessions: Math.max(1, Math.floor(targetCountPerDay / 2)),
        adherenceTargets: [target],
      },
      assistantSupport: {
        remindersEnabled: true,
      },
    },
  });
}

function makeSession(
  entityId: string,
  occurredAt: string,
  status: "completed" | "partial" | "missed" | "skipped" = "completed",
): CanonicalEntity {
  return makeEntity({
    entityId,
    family: "event",
    kind: "intervention_session",
    recordClass: "ledger",
    occurredAt,
    date: "2026-08-01",
    experimentSlug: EXPERIMENT_SLUG,
    title: `${status} strength set`,
    attributes: {
      experimentId: EXPERIMENT_ID,
      experimentSlug: EXPERIMENT_SLUG,
      interventionType: "strength-practice",
      sessionLocalDate: "2026-08-01",
      sessionStatus: status,
      source: "manual",
    },
    links: [{ type: "related_to", targetId: EXPERIMENT_ID }],
  });
}

function observation(
  evidenceId: string,
  status: ExperimentAdherenceObservation["status"] = "completed",
): ExperimentAdherenceObservation {
  return {
    evidenceId,
    eventKind: "intervention_session",
    localDate: "2026-08-01",
    source: "manual",
    status,
    targetId: "strength-set",
  };
}

function countRepeatedDay(input: {
  asOf: string;
  missing: "assumed_after_grace" | "missed_after_grace" | "unknown";
  observations: ExperimentAdherenceObservation[];
  graceHours?: number;
  localTime?: string;
  targetCountPerDay?: number;
}) {
  const target = repeatedTarget(input);
  const calendar = buildExperimentAdherenceCalendar({
    asOf: input.asOf,
    observations: input.observations,
    targets: [target],
    windows: {
      baselineEnd: null,
      baselineStart: null,
      interventionEnd: "2026-08-01",
      interventionStart: "2026-08-01",
    },
  });

  return countCalendarAdherenceSessions({
    asOf: input.asOf,
    cells: calendar.cells,
    observations: input.observations,
    target,
  });
}

test("progress counts explicit repeated occurrences instead of one partial day", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/vault",
    entities: [
      makeExperiment({ missing: "missed_after_grace" }),
      makeSession("evt_01JNV4458HYPP53JDQCBP1QJFA", "2026-08-01T10:00:00.000Z"),
      makeSession("evt_01JNV4458HYPP53JDQCBP1QJFB", "2026-08-01T12:00:00.000Z"),
      makeSession("evt_01JNV4458HYPP53JDQCBP1QJFC", "2026-08-01T14:00:00.000Z"),
    ],
  });

  const progress = summarizeExperimentProgress(vault, EXPERIMENT_SLUG, {
    asOf: "2026-08-02",
  });

  assert.deepEqual(
    {
      completedSessions: progress.adherence.completedSessions,
      confirmedSessions: progress.adherence.confirmedSessions,
      expectedSessionsByNow: progress.adherence.expectedSessionsByNow,
      loggedSessions: progress.adherence.loggedSessions,
      status: progress.adherence.status,
      targetSessions: progress.adherence.targetSessions,
    },
    {
      completedSessions: 3,
      confirmedSessions: 3,
      expectedSessionsByNow: 8,
      loggedSessions: 3,
      status: "behind",
      targetSessions: 8,
    },
  );
});

test("progress never infers repeated occurrences from silence", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/vault",
    entities: [makeExperiment({ missing: "assumed_after_grace" })],
  });

  const progress = summarizeExperimentProgress(vault, EXPERIMENT_SLUG, {
    asOf: "2026-08-02",
  });

  assert.deepEqual(
    {
      assumedSessions: progress.adherence.assumedSessions ?? 0,
      completedSessions: progress.adherence.completedSessions,
      expectedSessionsByNow: progress.adherence.expectedSessionsByNow,
      loggedSessions: progress.adherence.loggedSessions,
      status: progress.adherence.status,
    },
    {
      assumedSessions: 0,
      completedSessions: 0,
      expectedSessionsByNow: 8,
      loggedSessions: 0,
      status: "not_started",
    },
  );
});

test("progress caps duplicate explicit events at a once-daily target", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/vault",
    entities: [
      makeExperiment({
        missing: "missed_after_grace",
        targetCountPerDay: 1,
      }),
      makeSession("evt_01JNV4458HYPP53JDQCBP1QJFD", "2026-08-01T10:00:00.000Z"),
      makeSession("evt_01JNV4458HYPP53JDQCBP1QJFE", "2026-08-01T12:00:00.000Z"),
    ],
  });

  const progress = summarizeExperimentProgress(vault, EXPERIMENT_SLUG, {
    asOf: "2026-08-02",
  });

  assert.equal(progress.adherence.completedSessions, 1);
  assert.equal(progress.adherence.confirmedSessions, 1);
  assert.equal(progress.adherence.expectedSessionsByNow, 1);
  assert.equal(progress.adherence.loggedSessions, 1);
  assert.deepEqual(progress.adherence.sessionEventIds, [
    "evt_01JNV4458HYPP53JDQCBP1QJFD",
  ]);
  assert.equal(progress.adherence.status, "met_target");
});

test("only explicit repeated occurrences are due before the aggregate grace closes", () => {
  const counts = countRepeatedDay({
    asOf: "2026-08-01T15:00:00.000Z",
    graceHours: 4,
    localTime: "20:00",
    missing: "missed_after_grace",
    observations: [
      observation("evt_early_1"),
      observation("evt_early_2"),
      observation("evt_early_3"),
    ],
  });

  assert.deepEqual(
    {
      completedSessions: counts.completedSessions,
      expectedSessionsByNow: counts.expectedSessionsByNow,
      missedSessions: counts.missedSessions,
    },
    {
      completedSessions: 3,
      expectedSessionsByNow: 3,
      missedSessions: 0,
    },
  );
});

test("missing repeated occurrences become missed only after grace", () => {
  const counts = countRepeatedDay({
    asOf: "2026-08-02T01:00:00.000Z",
    graceHours: 4,
    localTime: "20:00",
    missing: "missed_after_grace",
    observations: [
      observation("evt_missed_remainder_1"),
      observation("evt_missed_remainder_2"),
      observation("evt_missed_remainder_3"),
    ],
  });

  assert.equal(counts.completedSessions, 3);
  assert.equal(counts.confirmedSessions, 3);
  assert.equal(counts.expectedSessionsByNow, 8);
  assert.equal(counts.missedSessions, 5);
});

test("legacy assumed repeated targets never infer the unobserved remainder", () => {
  const counts = countRepeatedDay({
    asOf: "2026-08-02T01:00:00.000Z",
    graceHours: 4,
    localTime: "20:00",
    missing: "assumed_after_grace",
    observations: [
      observation("evt_assumed_remainder_1"),
      observation("evt_assumed_remainder_2"),
      observation("evt_assumed_remainder_3"),
    ],
  });

  assert.equal(counts.completedSessions, 3);
  assert.equal(counts.confirmedSessions, 3);
  assert.equal(counts.assumedSessions, 0);
  assert.equal(counts.expectedSessionsByNow, 8);
  assert.equal(counts.missedSessions, 5);
});

test("server progress repairs a persisted legacy target from protocol sessions per day", () => {
  const runPlan = {
    interventionStart: "2026-08-01",
    interventionEnd: "2026-08-01",
    modality: "Strength practice",
    schedule: {
      kind: "dailyLocal" as const,
      localTime: "09:00",
      timeZone: "UTC",
    },
    targetSessions: 8,
    minimumUsefulSessions: 6,
  };
  const legacyTargets = synthesizeLegacySessionAdherenceTargets({ runPlan });
  const experiment = makeEntity({
    entityId: EXPERIMENT_ID,
    family: "experiment",
    kind: "experiment_entry",
    recordClass: "bank",
    occurredAt: "2026-08-01T08:00:00.000Z",
    date: "2026-08-01",
    experimentSlug: EXPERIMENT_SLUG,
    status: "active",
    title: "Repeated strength",
    attributes: {
      schemaVersion: "murph.frontmatter.experiment.v1",
      docType: "experiment",
      experimentId: EXPERIMENT_ID,
      slug: EXPERIMENT_SLUG,
      title: "Repeated strength",
      status: "active",
      startedOn: "2026-08-01",
      effectiveProtocolSnapshot: {
        effectiveSpecHash: `sha256:${"4".repeat(64)}`,
        doseSignature: "Eight small strength sets daily",
        frequency: { sessionsPerDay: 8 },
      },
      runPlan: { ...runPlan, adherenceTargets: legacyTargets },
    },
  });
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/repeated-strength-protocol-repair",
    metadata: { timezone: "UTC" },
    entities: [experiment],
  });

  const progress = summarizeExperimentProgress(vault, EXPERIMENT_SLUG, {
    asOf: "2026-08-03",
  });

  assert.equal(progress.adherence.expectedSessionsByNow, 8);
  assert.equal(progress.adherence.assumedSessions ?? 0, 0);
  assert.equal(progress.adherence.completedSessions, 0);
});

test("explicit skipped occurrences preserve adherence v1 missed semantics", () => {
  const counts = countRepeatedDay({
    asOf: "2026-08-02T01:00:00.000Z",
    missing: "unknown",
    observations: [
      observation("evt_completed_1"),
      observation("evt_skipped_1", "skipped"),
    ],
    targetCountPerDay: 3,
  });

  assert.equal(counts.completedSessions, 1);
  assert.equal(counts.expectedSessionsByNow, 3);
  assert.equal(counts.missedSessions, 1);
  assert.equal(counts.skippedSessions, 0);
});

test("counts each evidence id at most once", () => {
  const duplicate = observation("evt_duplicate");
  const counts = countRepeatedDay({
    asOf: "2026-08-02T01:00:00.000Z",
    missing: "missed_after_grace",
    observations: [duplicate, { ...duplicate }, observation("evt_unique")],
    targetCountPerDay: 3,
  });

  assert.equal(counts.completedSessions, 2);
  assert.equal(counts.confirmedSessions, 2);
  assert.equal(counts.expectedSessionsByNow, 3);
  assert.equal(counts.missedSessions, 1);
  assert.deepEqual(counts.loggedEvidenceIds, ["evt_duplicate", "evt_unique"]);
});

test("capped occurrence selection prefers a completed log over a partial log", () => {
  const counts = countRepeatedDay({
    asOf: "2026-08-02T01:00:00.000Z",
    missing: "missed_after_grace",
    observations: [
      observation("evt_partial", "partial"),
      observation("evt_completed"),
    ],
    targetCountPerDay: 1,
  });

  assert.equal(counts.completedSessions, 1);
  assert.equal(counts.partialSessions, 0);
  assert.deepEqual(counts.loggedEvidenceIds, ["evt_completed"]);
});
