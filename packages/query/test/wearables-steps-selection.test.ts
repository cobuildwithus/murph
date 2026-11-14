import assert from "node:assert/strict";

import { test } from "vitest";

import { isPartialCountOfFinishedDay, resolveLocalDayEndMs } from "../src/wearables/metric-policies.ts";
import { resolveMetric } from "../src/wearables/selection.ts";
import type { WearableMetricCandidate } from "../src/wearables/types.ts";

const date = "2026-05-03";

function steps(
  source: string,
  sourceType: string,
  value: number,
  overrides: { partial?: boolean; recordedAt?: string; stream?: "activity" | "steps" } = {},
): WearableMetricCandidate {
  const stream = overrides.stream ?? "activity";
  const candidateId = `junction:${source}:${stream}`;
  return {
    candidateId,
    dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: source, sourceType },
    date,
    externalRef: {
      facet: "daily-steps",
      resourceId: `${source}-${stream}`,
      resourceType: `junction-${source}-${stream}`,
      system: "junction",
      version: null,
    },
    metric: "steps",
    occurredAt: `${date}T00:00:00.000Z`,
    ...(overrides.partial ? { partialCountOfFinishedDay: true } : {}),
    paths: [`/virtual/${candidateId}.jsonl`],
    provider: "junction",
    recordedAt: overrides.recordedAt ?? `${date}T20:00:00.000Z`,
    recordIds: [candidateId],
    sourceFamily: "event",
    sourceKind: "observation",
    title: null,
    unit: "count",
    value,
  };
}

const appleHealth = (value: number, recordedAt?: string) =>
  steps("apple-health-kit", "multiple_sources", value, { recordedAt });
const selected = (...candidates: WearableMetricCandidate[]) =>
  resolveMetric("steps", candidates, { metricFamily: "activity" }).selection.value;

test("a worn device's daily total replaces a merged total that counted it twice", () => {
  assert.equal(selected(appleHealth(15_000, `${date}T23:00:00.000Z`), steps("whoop-v2", "watch", 10_000)), 10_000);
});

test("a worn device's daily total replaces a merged total that missed steps", () => {
  assert.equal(selected(appleHealth(9_000, `${date}T23:00:00.000Z`), steps("garmin", "watch", 10_000)), 10_000);
});

test("the device's daily total wins over its own higher intraday stream", () => {
  assert.equal(selected(
    appleHealth(9_000),
    steps("garmin", "watch", 10_000),
    steps("garmin", "watch", 11_000, { stream: "steps" }),
  ), 10_000);
});

test("the highest worn device wins when two report", () => {
  assert.equal(selected(appleHealth(12_000), steps("whoop-v2", "watch", 8_000), steps("oura", "ring", 10_000)), 10_000);
});

test("a device counting at least half of the merged total was worn", () => {
  assert.equal(selected(appleHealth(10_000), steps("garmin", "watch", 5_000)), 5_000);
});

test("the merged total stands when the device came off or reported nothing", () => {
  assert.equal(selected(appleHealth(10_000), steps("garmin", "watch", 4_999)), 10_000);
  assert.equal(selected(appleHealth(10_000), steps("whoop-v2", "watch", 0)), 10_000);
});

test("an off device does not win on recency when it has no direct integration", () => {
  assert.equal(selected(appleHealth(10_000), steps("fitbit", "watch", 4_000, { recordedAt: `${date}T23:00:00.000Z` })), 10_000);
});

test("a retained direct row does not cancel a worn device's preference over the merged total", () => {
  const direct: WearableMetricCandidate = {
    ...steps("garmin", "watch", 10_000),
    candidateId: "garmin:direct",
    dataOrigin: null,
    externalRef: { facet: null, resourceId: "direct", resourceType: "daily_activity", system: "garmin", version: null },
    provider: "garmin",
  };
  assert.equal(selected(appleHealth(15_000), steps("garmin", "watch", 10_000), direct), 10_000);
});

test("stored source types keep their normalized spelling", () => {
  assert.equal(selected(steps("apple-health-kit", "multiple-sources", 15_000), steps("garmin", "watch", 10_000)), 10_000);
});

test("a device's intraday stream alone does not replace the merged total", () => {
  assert.equal(selected(appleHealth(10_000), steps("garmin", "watch", 12_000, { stream: "steps" })), 10_000);
});

test("without a worn device the daily total is chosen as before", () => {
  assert.equal(selected(appleHealth(10_000), steps("apple-health-kit", "multiple_sources", 2_000, { stream: "steps" })), 10_000);
});

test("every candidate stays on the resolved metric so raw rows are still suppressed", () => {
  const candidates = [appleHealth(15_000), steps("whoop-v2", "watch", 10_000)];
  const resolved = resolveMetric("steps", candidates, { metricFamily: "activity" });
  assert.equal(resolved.candidates.length, candidates.length);
  assert.equal(resolved.candidates[0]?.value, 10_000);
});

test("a partial count of a finished day does not stand in for the device's total", () => {
  assert.equal(selected(appleHealth(11_000), steps("whoop-v2", "watch", 6_000, { partial: true })), 11_000);
  assert.equal(selected(
    appleHealth(11_000, `${date}T10:00:00.000Z`),
    steps("whoop-v2", "watch", 12_000, { partial: true, recordedAt: `${date}T23:00:00.000Z` }),
  ), 11_000);
});

test("another device's full total still counts beside a partial one", () => {
  assert.equal(selected(
    appleHealth(12_000),
    steps("whoop-v2", "watch", 11_000, { partial: true }),
    steps("oura", "ring", 9_000),
  ), 9_000);
});

test("a partial count stays available when no merged total exists", () => {
  assert.equal(selected(steps("whoop-v2", "watch", 6_000, { partial: true })), 6_000);
});

test("a device that reported nothing never outranks the merged total, however fresh", () => {
  assert.equal(selected(
    steps("whoop-v2", "watch", 0, { recordedAt: `${date}T23:00:00.000Z` }),
    steps("garmin", "watch", 0, { recordedAt: `${date}T22:00:00.000Z`, stream: "steps" }),
    steps("oura", "ring", 0, { recordedAt: `${date}T21:00:00.000Z`, stream: "steps" }),
    appleHealth(9_000, `${date}T10:00:00.000Z`),
  ), 9_000);
});

test("a fresher sum of a store's samples does not replace a worn daily total", () => {
  for (const sourceType of ["phone", "watch", "unknown", "multiple_sources"]) {
    assert.equal(selected(
      steps("whoop-v2", "watch", 10_000),
      steps("apple-health-kit", sourceType, 6_000, { recordedAt: `${date}T23:00:00.000Z`, stream: "steps" }),
    ), 10_000, sourceType);
  }
});

test("without a merged total, a worn total that cannot count leaves the standard ranking", () => {
  const fresherSum = (value: number) =>
    steps("apple-health-kit", "phone", value, { recordedAt: `${date}T23:00:00.000Z`, stream: "steps" });
  assert.equal(selected(steps("whoop-v2", "watch", 0), fresherSum(6_000)), 6_000);
  assert.equal(selected(steps("whoop-v2", "watch", 5_000, { partial: true }), fresherSum(6_000)), 6_000);
});

test("a day ends at the next local midnight of the record's own time zone", () => {
  const end = (day: string, timeZone: string | null, offsetMinutes?: number | null) => {
    const ms = resolveLocalDayEndMs(day, timeZone, offsetMinutes);
    return ms === null ? null : new Date(ms).toISOString();
  };

  assert.equal(end("2026-05-03", "America/New_York"), "2026-05-04T04:00:00.000Z");
  assert.equal(end("2026-12-03", "America/New_York"), "2026-12-04T05:00:00.000Z");
  assert.equal(end("2026-05-03", "Asia/Tokyo"), "2026-05-03T15:00:00.000Z");
  assert.equal(end("2026-05-03", "Asia/Kolkata"), "2026-05-03T18:30:00.000Z");
  assert.equal(end("2026-05-03", "UTC"), "2026-05-04T00:00:00.000Z");
  // The day clocks go back lasts 25 hours and the day they go forward lasts 23.
  assert.equal(end("2026-10-31", "America/New_York"), "2026-11-01T04:00:00.000Z");
  assert.equal(end("2026-11-01", "America/New_York"), "2026-11-02T05:00:00.000Z");
  assert.equal(end("2026-03-07", "America/New_York"), "2026-03-08T05:00:00.000Z");
  assert.equal(end("2026-03-08", "America/New_York"), "2026-03-09T04:00:00.000Z");
  assert.equal(end("2026-10-25", "Europe/London"), "2026-10-26T00:00:00.000Z");
  assert.equal(end("2026-03-29", "Europe/Berlin"), "2026-03-29T22:00:00.000Z");
  // South of the equator the changes fall in the opposite seasons.
  assert.equal(end("2026-09-26", "Pacific/Auckland"), "2026-09-26T12:00:00.000Z");
  assert.equal(end("2026-09-27", "Pacific/Auckland"), "2026-09-27T11:00:00.000Z");
  assert.equal(end("2026-04-05", "Pacific/Auckland"), "2026-04-05T12:00:00.000Z");
});

test("a record's UTC offset stands in when it names no usable time zone", () => {
  const end = (timeZone: string | null, offsetMinutes?: number | null) => {
    const ms = resolveLocalDayEndMs("2026-05-03", timeZone, offsetMinutes);
    return ms === null ? null : new Date(ms).toISOString();
  };

  assert.equal(end(null, -240), "2026-05-04T04:00:00.000Z");
  assert.equal(end(null, 540), "2026-05-03T15:00:00.000Z");
  assert.equal(end(null, 0), "2026-05-04T00:00:00.000Z");
  assert.equal(end("Not/AZone", -240), "2026-05-04T04:00:00.000Z");
  assert.equal(end("America/New_York", 540), "2026-05-04T04:00:00.000Z");
  assert.equal(end(null), null);
  assert.equal(end(null, null), null);
  assert.equal(end("Not/AZone"), null);
  assert.equal(resolveLocalDayEndMs("not-a-date", "UTC", 0), null);
  // The last representable date has no next day to end on.
  assert.equal(resolveLocalDayEndMs("9999-12-31", "America/New_York", -300), null);
});

test("a total is a partial count only when recorded before a day end the vault has seen pass", () => {
  const dayEndMs = Date.parse("2026-05-04T04:00:00.000Z");
  const partial = (recordedAt: string | null, evidenceThrough: string, end: number | null = dayEndMs) =>
    isPartialCountOfFinishedDay({ dayEndMs: end, evidenceThroughMs: Date.parse(evidenceThrough), recordedAt });

  assert.equal(partial("2026-05-03T19:00:00.000Z", "2026-05-04T12:00:00.000Z"), true);
  assert.equal(partial("2026-05-04T03:59:59.999Z", "2026-05-04T04:00:00.000Z"), true);
  // Recorded exactly at the day's end, or later: the full day.
  assert.equal(partial("2026-05-04T04:00:00.000Z", "2026-05-04T12:00:00.000Z"), false);
  assert.equal(partial("2026-05-04T09:00:00.000Z", "2026-05-04T12:00:00.000Z"), false);
  // Nothing recorded after the day ended yet: it may still be today.
  assert.equal(partial("2026-05-03T19:00:00.000Z", "2026-05-04T03:59:59.999Z"), false);
  assert.equal(partial("2026-05-03T19:00:00.000Z", "2026-05-04T12:00:00.000Z", null), false);
  assert.equal(partial(null, "2026-05-04T12:00:00.000Z"), false);
  assert.equal(partial("not a time", "2026-05-04T12:00:00.000Z"), false);
  assert.equal(isPartialCountOfFinishedDay({
    dayEndMs, evidenceThroughMs: Number.NEGATIVE_INFINITY, recordedAt: "2026-05-03T19:00:00.000Z",
  }), false);
});
