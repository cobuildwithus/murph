import assert from "node:assert/strict";

import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import { summarizeWearableSleepPattern } from "../src/wearables.ts";

interface SleepWindowFixture {
  date: string;
  endAt: string;
  id: string;
  recordedAt: string;
  startAt: string;
}

const SLEEP_WINDOWS: readonly SleepWindowFixture[] = [
  {
    date: "2026-07-02",
    endAt: "2026-07-02T11:00:00.000Z",
    id: "sleep-weekday-one",
    recordedAt: "2026-07-02T11:05:00.000Z",
    startAt: "2026-07-02T03:00:00.000Z",
  },
  {
    date: "2026-07-03",
    endAt: "2026-07-03T11:15:00.000Z",
    id: "sleep-weekday-two",
    recordedAt: "2026-07-03T11:20:00.000Z",
    startAt: "2026-07-03T03:15:00.000Z",
  },
  {
    date: "2026-07-04",
    endAt: "2026-07-04T13:00:00.000Z",
    id: "sleep-weekend-one",
    recordedAt: "2026-07-04T13:05:00.000Z",
    startAt: "2026-07-04T05:00:00.000Z",
  },
  {
    date: "2026-07-05",
    endAt: "2026-07-05T13:30:00.000Z",
    id: "sleep-weekend-two",
    recordedAt: "2026-07-05T13:35:00.000Z",
    startAt: "2026-07-05T05:30:00.000Z",
  },
];

function canonicalEntity(input: {
  attributes: Record<string, unknown>;
  entityId: string;
  kind: string;
  occurredAt: string;
  title: string;
}): CanonicalEntity {
  return {
    attributes: input.attributes,
    body: null,
    date: null,
    entityId: input.entityId,
    experimentSlug: null,
    family: "event",
    frontmatter: null,
    kind: input.kind,
    links: [],
    lookupIds: [input.entityId],
    occurredAt: input.occurredAt,
    path: `ledger/events/${input.entityId}.jsonl`,
    primaryLookupId: input.entityId,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: input.title,
  };
}

function sleepWindowEntity(window: SleepWindowFixture): CanonicalEntity {
  return canonicalEntity({
    attributes: {
      dayKey: window.date,
      durationMinutes: 480,
      endAt: window.endAt,
      externalRef: {
        facet: null,
        resourceId: window.id,
        resourceType: "sleep",
        system: "oura",
        version: null,
      },
      recordedAt: window.recordedAt,
      sleepType: "main_sleep",
      startAt: window.startAt,
      timeZone: "America/New_York",
    },
    entityId: `evt-${window.id}`,
    kind: "sleep_session",
    occurredAt: window.endAt,
    title: "Main sleep",
  });
}

function stageEntity(
  window: SleepWindowFixture,
  stage: "deep" | "rem",
  durationMinutes: number,
): CanonicalEntity {
  return canonicalEntity({
    attributes: {
      dayKey: window.date,
      durationMinutes,
      externalRef: {
        facet: stage,
        resourceId: window.id,
        resourceType: "sleep_stage",
        system: "oura",
        version: null,
      },
      recordedAt: window.recordedAt,
      stage,
    },
    entityId: `evt-${window.id}-${stage}`,
    kind: "observation",
    occurredAt: window.endAt,
    title: `${stage} estimate`,
  });
}

function sleepPattern(entities: readonly CanonicalEntity[]) {
  return summarizeWearableSleepPattern(
    createVaultReadModel({
      entities: [...entities],
      metadata: { timezone: "America/New_York" },
      vaultRoot: "/virtual/sleep-complaint-pattern",
    }),
    {
      from: "2026-07-02",
      now: "2026-07-06T16:00:00.000Z",
      timeZone: "America/New_York",
      to: "2026-07-05",
    },
  );
}

test("circadian-pattern observation stays independent of consumer sleep-stage estimates", () => {
  const windows = SLEEP_WINDOWS.map(sleepWindowEntity);
  const stageHeavy = SLEEP_WINDOWS.flatMap((window, index) => [
    stageEntity(window, "deep", index % 2 === 0 ? 20 : 240),
    stageEntity(window, "rem", index % 2 === 0 ? 220 : 15),
  ]);

  const withoutStages = sleepPattern(windows);
  const withContradictoryStages = sleepPattern([...windows, ...stageHeavy]);

  assert.equal(withContradictoryStages.validNightCount, 4);
  assert.equal(withContradictoryStages.expectedNightCount, 4);
  assert.equal(withContradictoryStages.missingNightCount, 0);
  assert.equal(withContradictoryStages.latestNightDate, "2026-07-05");
  assert.equal(withContradictoryStages.latestNightAgeDays, 1);
  assert.equal(withContradictoryStages.allSourcesStale, false);
  assert.ok((withContradictoryStages.bedtime.standardDeviationMinutes ?? 0) > 0);
  assert.ok((withContradictoryStages.weekdayWeekendMidpointDriftMinutes ?? 0) > 60);

  assert.deepEqual(withContradictoryStages.bedtime, withoutStages.bedtime);
  assert.deepEqual(withContradictoryStages.wakeTime, withoutStages.wakeTime);
  assert.deepEqual(withContradictoryStages.midpoint, withoutStages.midpoint);
  assert.deepEqual(
    withContradictoryStages.sessionDurationMinutes,
    withoutStages.sessionDurationMinutes,
  );
  assert.equal("deepMinutes" in withContradictoryStages, false);
  assert.equal("remMinutes" in withContradictoryStages, false);
  assert.equal("sleepScore" in withContradictoryStages, false);
});

test("exact sleep-pattern dates are applied after canonical sleep-end localization", () => {
  const storedOnPriorDate = canonicalEntity({
    attributes: {
      dayKey: "2026-07-09",
      durationMinutes: 480,
      endAt: "2026-07-10T00:30:00.000Z",
      externalRef: {
        facet: null,
        resourceId: "localized-next-day",
        resourceType: "sleep",
        system: "oura",
        version: null,
      },
      recordedAt: "2026-07-10T00:35:00.000Z",
      sleepType: "main_sleep",
      startAt: "2026-07-09T16:30:00.000Z",
      timeZone: "Asia/Tokyo",
    },
    entityId: "evt-localized-next-day",
    kind: "sleep_session",
    occurredAt: "2026-07-10T00:30:00.000Z",
    title: "Main sleep",
  });

  const summary = summarizeWearableSleepPattern(
    createVaultReadModel({
      entities: [storedOnPriorDate],
      metadata: { timezone: "Asia/Tokyo" },
      vaultRoot: "/virtual/localized-sleep-date",
    }),
    {
      date: "2026-07-10",
      now: "2026-07-11T00:00:00.000Z",
      timeZone: "Asia/Tokyo",
    },
  );

  assert.equal(summary.from, "2026-07-10");
  assert.equal(summary.to, "2026-07-10");
  assert.equal(summary.validNightCount, 1);
  assert.equal(summary.latestNightDate, "2026-07-10");
  assert.equal(summary.sourceFreshness[0]?.lastSleepEvidenceDate, "2026-07-10");
  assert.equal(summary.notes.some((note) => note.includes("localized sleep-end date")), true);
});
