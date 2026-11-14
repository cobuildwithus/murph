import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  listMetricPoints,
  readVaultRawTolerant,
  rebuildQueryProjection,
  summarizeWearableActivityRuntime,
} from "../src/index.ts";
import { summarizeWearableActivity } from "../src/wearables.ts";

interface StepsRecord {
  date: string;
  offsetMinutes?: number;
  recordedAt: string;
  source: "apple-health-kit" | "oura" | "whoop-v2";
  timeZone?: string;
  value: number;
}

const SOURCE_TYPES = { "apple-health-kit": "multiple_sources", oura: "ring", "whoop-v2": "watch" } as const;

/** A daily activity summary as the Junction importer stores it. */
function stepsEvent(record: StepsRecord) {
  return {
    schemaVersion: "murph.event.v1",
    id: `evt_steps_${record.source.replaceAll("-", "_")}_${record.date.replaceAll("-", "")}`,
    kind: "observation",
    occurredAt: `${record.date}T00:00:00Z`,
    recordedAt: record.recordedAt,
    dayKey: record.date,
    ...(record.timeZone ? { timeZone: record.timeZone } : {}),
    source: "device",
    title: `${record.source} steps`,
    metric: "steps",
    value: record.value,
    unit: "count",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "junction",
      sourceProviderSlug: record.source,
      sourceType: SOURCE_TYPES[record.source],
      ...(record.offsetMinutes === undefined ? {} : { timeZoneOffsetMinutes: record.offsetMinutes }),
    },
    externalRef: { system: "junction", resourceType: `junction-${record.source}-activity` },
  };
}

/** The day's steps as every reader sees them: read from records, and from the stored projection. */
async function readSteps(records: readonly StepsRecord[], date: string, otherEvents: readonly object[] = []) {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-steps-day-end-"));
  try {
    const byMonth = new Map<string, string[]>();
    for (const record of records) {
      const month = record.date.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), JSON.stringify(stepsEvent(record))]);
    }
    if (otherEvents.length > 0) {
      const month = date.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), ...otherEvents.map((event) => JSON.stringify(event))]);
    }
    for (const [month, lines] of byMonth) {
      const ledgerPath = path.join(vaultRoot, `ledger/events/${month.slice(0, 4)}/${month}.jsonl`);
      await mkdir(path.dirname(ledgerPath), { recursive: true });
      await writeFile(ledgerPath, `${lines.join("\n")}\n`, "utf8");
    }

    const vault = await readVaultRawTolerant(vaultRoot);
    const value = (days: readonly { date: string; steps: { selection: { value: number | null } } }[]) =>
      days.find((day) => day.date === date)?.steps.selection.value ?? null;
    const fromRecords = value(summarizeWearableActivity(vault, { date }));
    const fromRecordsUnfiltered = value(summarizeWearableActivity(vault, { limit: 30 }));
    await rebuildQueryProjection(vaultRoot);
    const stored = async (providers?: string[]) =>
      value(await summarizeWearableActivityRuntime(vaultRoot, { date, ...(providers ? { providers } : {}) }));
    const points = (await listMetricPoints(vaultRoot, { metricKey: "steps" }))
      .filter((point) => point.effectiveDate === date);

    return {
      fromRecords,
      fromRecordsUnfiltered,
      stored: await stored(),
      storedUnfiltered: value(await summarizeWearableActivityRuntime(vaultRoot, { limit: 30 })),
      storedWhoopOnly: await stored(["whoop"]),
      storedAppleOnly: await stored(["apple-health-kit"]),
      metricPoints: points.map((point) => point.value),
    };
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

/** Records, stored rows and the day's metric point agree on one number, with and without a date filter. */
async function assertSteps(
  records: readonly StepsRecord[],
  date: string,
  expected: number,
  otherEvents: readonly object[] = [],
) {
  const steps = await readSteps(records, date, otherEvents);
  assert.deepEqual(
    {
      fromRecords: steps.fromRecords,
      fromRecordsUnfiltered: steps.fromRecordsUnfiltered,
      stored: steps.stored,
      storedUnfiltered: steps.storedUnfiltered,
      metricPoints: steps.metricPoints,
    },
    {
      fromRecords: expected,
      fromRecordsUnfiltered: expected,
      stored: expected,
      storedUnfiltered: expected,
      metricPoints: [expected],
    },
  );
  return steps;
}

const newYork = "America/New_York";
// 2026-11-10 in New York ends at 05:00 UTC on the 11th.
const day = "2026-11-10";
const nextMorning: StepsRecord = {
  date: "2026-11-11", recordedAt: "2026-11-11T13:00:00Z", source: "apple-health-kit", timeZone: newYork, value: 1_200,
};
const phoneEvening: StepsRecord = {
  date: day, recordedAt: "2026-11-11T02:00:00Z", source: "apple-health-kit", timeZone: newYork, value: 11_000,
};
const whoop = (recordedAt: string, value = 6_000, zone: Partial<StepsRecord> = { timeZone: newYork }): StepsRecord =>
  ({ date: day, recordedAt, source: "whoop-v2", value, ...zone });

test("a finished day takes the merged total when the device last reported mid-afternoon", async () => {
  const steps = await assertSteps([whoop("2026-11-10T20:00:00Z"), phoneEvening, nextMorning], day, 11_000);

  // Each source's own number is untouched.
  assert.equal(steps.storedWhoopOnly, 6_000);
  assert.equal(steps.storedAppleOnly, 11_000);
});

test("the day still open keeps the device's total", async () => {
  await assertSteps([whoop("2026-11-10T20:00:00Z"), phoneEvening], day, 6_000);
});

test("a device total recorded at or after the day's end counts", async () => {
  await assertSteps([whoop("2026-11-11T05:00:00Z"), phoneEvening, nextMorning], day, 6_000);
  await assertSteps([whoop("2026-11-11T04:59:59Z"), phoneEvening, nextMorning], day, 11_000);
  await assertSteps([whoop("2026-11-11T12:00:00Z"), phoneEvening, nextMorning], day, 6_000);
});

test("a full device total under half of the merged total still means the device came off", async () => {
  await assertSteps([whoop("2026-11-11T12:00:00Z", 5_000), phoneEvening, nextMorning], day, 11_000);
});

test("the record's own time zone decides when its day ended", async () => {
  // 09:00 UTC on the 11th is after midnight in New York and before it in Honolulu.
  const recordedAt = "2026-11-11T09:00:00Z";
  const later: StepsRecord = { ...nextMorning, recordedAt: "2026-11-11T20:00:00Z" };
  await assertSteps([whoop(recordedAt), phoneEvening, later], day, 6_000);
  await assertSteps([whoop(recordedAt, 6_000, { timeZone: "Pacific/Honolulu" }), phoneEvening, later], day, 11_000);
  // 16:00 UTC on the 10th is already the 11th in Tokyo.
  await assertSteps([whoop("2026-11-10T16:00:00Z", 6_000, { timeZone: "Asia/Tokyo" }), phoneEvening, later], day, 6_000);
});

test("a UTC offset decides the day's end when the record names no time zone", async () => {
  await assertSteps([whoop("2026-11-11T05:00:00Z", 6_000, { offsetMinutes: -300 }), phoneEvening, nextMorning], day, 6_000);
  await assertSteps([whoop("2026-11-11T04:30:00Z", 6_000, { offsetMinutes: -300 }), phoneEvening, nextMorning], day, 11_000);
});

test("a record with neither a time zone nor an offset keeps the rule as it was", async () => {
  await assertSteps([whoop("2026-11-10T20:00:00Z", 6_000, {}), phoneEvening, nextMorning], day, 6_000);
});

test("the 25-hour day clocks go back ends an hour later than the offset it began with", async () => {
  // 2026-11-01 in New York starts on UTC-4 and ends at 05:00 UTC on the 2nd, on UTC-5.
  const fallBack = "2026-11-01";
  const phone: StepsRecord = {
    date: fallBack, recordedAt: "2026-11-02T01:00:00Z", source: "apple-health-kit", timeZone: newYork, value: 11_000,
  };
  const after: StepsRecord = { ...nextMorning, date: "2026-11-02", recordedAt: "2026-11-02T14:00:00Z" };
  const device = (recordedAt: string): StepsRecord =>
    ({ date: fallBack, recordedAt, source: "whoop-v2", timeZone: newYork, value: 6_000 });

  await assertSteps([device("2026-11-02T04:30:00Z"), phone, after], fallBack, 11_000);
  await assertSteps([device("2026-11-02T05:00:00Z"), phone, after], fallBack, 6_000);
});

test("the 23-hour day clocks go forward ends an hour earlier than the offset it began with", async () => {
  // 2026-03-08 in New York starts on UTC-5 and ends at 04:00 UTC on the 9th, on UTC-4.
  const springForward = "2026-03-08";
  const phone: StepsRecord = {
    date: springForward, recordedAt: "2026-03-09T01:00:00Z", source: "apple-health-kit", timeZone: newYork, value: 11_000,
  };
  const after: StepsRecord = { ...nextMorning, date: "2026-03-09", recordedAt: "2026-03-09T14:00:00Z" };
  const device = (recordedAt: string): StepsRecord =>
    ({ date: springForward, recordedAt, source: "whoop-v2", timeZone: newYork, value: 6_000 });

  await assertSteps([device("2026-03-09T03:59:59Z"), phone, after], springForward, 11_000);
  await assertSteps([device("2026-03-09T04:00:00Z"), phone, after], springForward, 6_000);
});

test("another device's full total decides the day beside a partial one", async () => {
  const oura: StepsRecord = { date: day, recordedAt: "2026-11-11T11:00:00Z", source: "oura", timeZone: newYork, value: 9_000 };
  await assertSteps([whoop("2026-11-10T20:00:00Z", 10_500), oura, phoneEvening, nextMorning], day, 9_000);
});

test("a partial device total stays the day's number when nothing else reported", async () => {
  await assertSteps([whoop("2026-11-10T20:00:00Z"), nextMorning], day, 6_000);
});

test("only a steps total recorded after the day's end shows the day is finished", async () => {
  const reading = (id: string, occurredAt: string, extra: object) => ({
    schemaVersion: "murph.event.v1",
    id,
    kind: "observation",
    occurredAt,
    source: "device",
    title: "Reading",
    dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: "whoop-v2", sourceType: "watch" },
    ...extra,
  });
  // A real reading from the next morning: time has passed, but it is not a steps total.
  const nextMorningHeartRate = reading("evt_steps_day_end_next_morning_reading", "2026-11-11T11:00:00Z", {
    recordedAt: "2026-11-11T11:05:00Z",
    dayKey: "2026-11-11",
    metric: "resting-heart-rate",
    value: 54,
    unit: "bpm",
    externalRef: { system: "junction", resourceType: "junction-whoop-v2-sleep" },
  });

  await assertSteps([whoop("2026-11-10T20:00:00Z"), phoneEvening], day, 6_000, [nextMorningHeartRate]);
  await assertSteps([whoop("2026-11-10T20:00:00Z"), phoneEvening, nextMorning], day, 11_000, [nextMorningHeartRate]);
});

test("a record stamped with a time that stands for its day does not finish a day still open", async () => {
  // An overnight summary is stored at noon UTC on its wake date. In Auckland (UTC+13) that
  // is an hour after the same local day ends, though the day has only begun at upload time.
  const auckland = "Pacific/Auckland";
  const openDay = "2026-11-14";
  const overnightSummary = {
    schemaVersion: "murph.event.v1",
    id: "evt_steps_day_end_overnight_summary",
    kind: "observation",
    occurredAt: `${openDay}T12:00:00.000Z`,
    recordedAt: `${openDay}T12:00:00.000Z`,
    dayKey: openDay,
    source: "device",
    title: "Overnight heart rate variability",
    metric: "hrv",
    value: 61,
    unit: "ms",
    dataOrigin: {
      version: 1, aggregatorProvider: "junction", sourceProviderSlug: "whoop-v2", sourceType: "watch",
      timestampSemantics: "floating",
    },
    externalRef: { system: "junction", resourceType: "junction-whoop-v2-sleep" },
  };
  // 9 am and 3 pm local on the open day, both long before it ends at 11:00 UTC.
  const device: StepsRecord = {
    date: openDay, recordedAt: "2026-11-14T02:00:00Z", source: "whoop-v2", timeZone: auckland, value: 6_000,
  };
  const phone: StepsRecord = {
    date: openDay, recordedAt: "2026-11-13T20:00:00Z", source: "apple-health-kit", timeZone: auckland, value: 11_000,
  };

  await assertSteps([device, phone], openDay, 6_000, [overnightSummary]);
});

test("a record the member logged by hand does not show the day is finished", async () => {
  const loggedByHand = {
    schemaVersion: "murph.event.v1",
    id: "evt_steps_day_end_logged_by_hand",
    kind: "observation",
    occurredAt: "2026-11-11T11:00:00Z",
    recordedAt: "2026-11-11T11:05:00Z",
    dayKey: "2026-11-11",
    source: "manual",
    title: "Weight",
    metric: "weight",
    value: 80,
    unit: "kg",
    externalRef: { system: "manual", resourceType: "observation", resourceId: "logged-by-hand" },
  };

  await assertSteps([whoop("2026-11-10T20:00:00Z"), phoneEvening], day, 6_000, [loggedByHand]);
});
