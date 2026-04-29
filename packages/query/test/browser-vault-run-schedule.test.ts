import assert from "node:assert/strict";

import type { ExperimentRunScheduleIntent } from "@murphai/contracts";
import { test } from "vitest";

import {
  expandBrowserVaultRunSchedule,
  type BrowserVaultRunScheduleCell,
} from "../src/browser-replica/run-schedule.ts";

test("expands dailyLocal schedules and marks past today and future local dates", () => {
  const schedule = {
    kind: "dailyLocal",
    localTime: "08:00",
    timeZone: "America/New_York",
  } satisfies ExperimentRunScheduleIntent;

  const cells = expandBrowserVaultRunSchedule({
    asOf: "2026-04-10T16:30:00.000Z",
    schedule,
    window: {
      startLocalDate: "2026-04-08",
      endLocalDate: "2026-04-12",
    },
  });

  assert.deepEqual(compactCells(cells), [
    ["2026-04-08", "08:00", "missed", "planned", true],
    ["2026-04-09", "08:00", "missed", "planned", true],
    ["2026-04-10", "08:00", "scheduled", "planned", true],
    ["2026-04-11", "08:00", "scheduled", "planned", true],
    ["2026-04-12", "08:00", "scheduled", "planned", true],
  ]);
});

test("keeps past planned local dates scheduled until the grace period expires", () => {
  const schedule = {
    kind: "dailyLocal",
    localTime: "22:00",
    timeZone: "America/New_York",
  } satisfies ExperimentRunScheduleIntent;
  const window = {
    startLocalDate: "2026-04-09",
    endLocalDate: "2026-04-09",
  };

  assert.equal(
    expandBrowserVaultRunSchedule({
      asOf: "2026-04-10T16:00:00.000Z",
      schedule,
      window,
    })[0]?.kind,
    "scheduled",
  );
  assert.equal(
    expandBrowserVaultRunSchedule({
      asOf: "2026-04-11T03:00:00.000Z",
      schedule,
      window,
    })[0]?.kind,
    "missed",
  );
});

test("treats date-only asOf values as schedule-local dates", () => {
  const schedule = {
    kind: "dailyLocal",
    localTime: "08:00",
    timeZone: "America/Los_Angeles",
  } satisfies ExperimentRunScheduleIntent;

  const cells = expandBrowserVaultRunSchedule({
    asOf: "2026-04-29",
    gracePeriodHours: 0,
    schedule,
    window: {
      startLocalDate: "2026-04-28",
      endLocalDate: "2026-04-29",
    },
  });

  assert.deepEqual(compactCells(cells), [
    ["2026-04-28", "08:00", "missed", "planned", true],
    ["2026-04-29", "08:00", "scheduled", "planned", true],
  ]);
});

test("expands supported five-field weekday-list cron schedules by local date", () => {
  const schedule = {
    kind: "cron",
    expression: "0 8 * * 2,4,6",
    timeZone: "America/New_York",
  } satisfies ExperimentRunScheduleIntent;

  const cells = expandBrowserVaultRunSchedule({
    asOf: "2026-04-06T12:00:00.000Z",
    schedule,
    window: {
      startLocalDate: "2026-04-06",
      endLocalDate: "2026-04-12",
    },
  });

  assert.deepEqual(compactCells(cells), [
    ["2026-04-07", "08:00", "scheduled", "planned", true],
    ["2026-04-09", "08:00", "scheduled", "planned", true],
    ["2026-04-11", "08:00", "scheduled", "planned", true],
  ]);
});

test("lets same-local-day events win while preserving session statuses", () => {
  const schedule = {
    kind: "dailyLocal",
    localTime: "08:00",
    timeZone: "America/New_York",
  } satisfies ExperimentRunScheduleIntent;

  const cells = expandBrowserVaultRunSchedule({
    asOf: "2026-04-12T16:00:00.000Z",
    events: [
      { localDate: "2026-04-09", status: "completed" },
      { localDate: "2026-04-10", status: "partial" },
      { localDate: "2026-04-11", status: "skipped" },
      { localDate: "2026-04-12", status: "missed" },
    ],
    schedule,
    window: {
      startLocalDate: "2026-04-09",
      endLocalDate: "2026-04-12",
    },
  });

  assert.deepEqual(compactCells(cells), [
    ["2026-04-09", "08:00", "completed", "event", true],
    ["2026-04-10", "08:00", "partial", "event", true],
    ["2026-04-11", "08:00", "skipped", "event", true],
    ["2026-04-12", "08:00", "missed", "event", true],
  ]);
});

test("matches event timestamps to the schedule time zone local day", () => {
  const schedule = {
    kind: "dailyLocal",
    localTime: "08:00",
    timeZone: "America/New_York",
  } satisfies ExperimentRunScheduleIntent;

  const cells = expandBrowserVaultRunSchedule({
    asOf: "2026-04-11T16:00:00.000Z",
    events: [
      {
        occurredAt: "2026-04-11T03:30:00.000Z",
        status: "completed",
      },
    ],
    schedule,
    window: {
      startLocalDate: "2026-04-10",
      endLocalDate: "2026-04-11",
    },
  });

  assert.deepEqual(compactCells(cells), [
    ["2026-04-10", "08:00", "completed", "event", true],
    ["2026-04-11", "08:00", "scheduled", "planned", true],
  ]);
});

test("keeps off-schedule intervention events without marking them planned", () => {
  const schedule = {
    kind: "cron",
    expression: "0 8 * * 2,4",
    timeZone: "America/New_York",
  } satisfies ExperimentRunScheduleIntent;

  const cells = expandBrowserVaultRunSchedule({
    asOf: "2026-04-12T16:00:00.000Z",
    events: [
      {
        localDate: "2026-04-11",
        status: "completed",
      },
    ],
    schedule,
    window: {
      startLocalDate: "2026-04-07",
      endLocalDate: "2026-04-12",
    },
  });

  assert.deepEqual(compactCells(cells), [
    ["2026-04-07", "08:00", "missed", "planned", true],
    ["2026-04-09", "08:00", "missed", "planned", true],
    ["2026-04-11", "08:00", "completed", "event", false],
  ]);
});

test("rejects unsupported cron features instead of acting as a generic cron engine", () => {
  const schedule = {
    kind: "cron",
    expression: "0 8 * * 1-5",
    timeZone: "America/New_York",
  } satisfies ExperimentRunScheduleIntent;

  assert.throws(
    () =>
      expandBrowserVaultRunSchedule({
        asOf: "2026-04-06T12:00:00.000Z",
        schedule,
        window: {
          startLocalDate: "2026-04-06",
          endLocalDate: "2026-04-12",
        },
      }),
    /day-of-week must be a numeric weekday list/u,
  );
});

function compactCells(
  cells: readonly BrowserVaultRunScheduleCell[],
): [string, string, BrowserVaultRunScheduleCell["kind"], BrowserVaultRunScheduleCell["source"], boolean][] {
  return cells.map((cell) => [
    cell.localDate,
    cell.localTime,
    cell.kind,
    cell.source,
    cell.planned,
  ]);
}
