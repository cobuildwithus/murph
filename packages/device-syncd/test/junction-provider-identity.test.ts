import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createJob,
  createJunctionJobContext,
  createJunctionProvider,
  executeJunctionJob,
} from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

async function importTimeseriesRows(resource: string, records: Record<string, unknown>[]) {
  const imported: unknown[] = [];
  const requests: string[] = [];
  const provider = createJunctionProvider(async (input) => {
    const url = new URL(readUrl(input));
    requests.push(url.pathname);
    if (url.pathname === `/v2/timeseries/junction-user-1/${resource}/grouped`) {
      return createJsonResponse({
        groups: {
          oura: [{ data: records, source: { provider: "oura", type: "ring" } }],
        },
      });
    }
    throw new Error(`Unexpected request path: ${url.pathname}`);
  }, { summaryResources: [], timeseriesResources: [resource] });
  await executeJunctionJob(provider, createJunctionJobContext({
    now: "2026-04-03T12:00:00.000Z",
    importSnapshot: async (snapshot) => { imported.push(snapshot); },
  }), createJob("reconcile", {
    timeseriesCursor: "2026-04-02T00:00:00.000Z",
    timeseriesResourceCursor: resource,
    windowStart: "2026-04-02T00:00:00.000Z",
    windowEnd: "2026-04-03T00:00:00.000Z",
  }));
  assert.deepEqual(requests, [`/v2/timeseries/junction-user-1/${resource}/grouped`]);
  assert.equal(imported.length, 1);
  // The callback receives the production provider snapshot; only its timeseries
  // collection is inspected, before the importer can arbitrate revisions.
  const snapshot = imported[0] as { timeseries: Record<string, unknown[]> };
  return snapshot.timeseries[resource];
}

const timestamp = "2026-04-02T12:00:00.000Z";
const baseRow = { timestamp, value: 90, unit: "mg/dL" };

for (const [field, alias] of [
  ["recordedAt", "recorded_at"],
  ["recorded_at", "updatedAt"],
  ["updatedAt", "updated_at"],
  ["timeZone", "timezone"],
  ["timezone", "time_zone"],
  ["timeZoneOffsetMinutes", "time_zone_offset_minutes"],
  ["time_zone_offset_minutes", "timezoneOffsetMinutes"],
  ["timezoneOffsetMinutes", "timezone_offset_minutes"],
  ["timezone_offset_minutes", "utcOffsetMinutes"],
  ["utcOffsetMinutes", "utc_offset_minutes"],
  ["timezone_offset", "timezoneOffset"],
  ["timezoneOffset", "timeZoneOffset"],
  ["timeZoneOffset", "time_zone_offset"],
  ["time_zone_offset", "timezoneOffsetSeconds"],
  ["timezoneOffsetSeconds", "timezone_offset_seconds"],
  ["timezone_offset_seconds", "timeZoneOffsetSeconds"],
  ["timeZoneOffsetSeconds", "time_zone_offset_seconds"],
  ["time_zone_offset_seconds", "utcOffsetSeconds"],
  ["utcOffsetSeconds", "utc_offset_seconds"],
  ["calendarDate", "calendar_date"],
  ["calendar_date", "localDate"],
  ["localDate", "local_date"],
  ["timestampSemantics", "timestamp_semantics"],
  ["value", "glucose"],
  ["glucose", "bloodGlucose"],
  ["bloodGlucose", "blood_glucose"],
  ["unit", "valueUnit"],
  ["valueUnit", "value_unit"],
] as const) {
  test(`Junction glucose identity preserves ${field} precedence over ${alias}`, async () => {
    const rows: Record<string, unknown>[] = [];
    for (const value of ["", 0, false, "selected"]) {
      const common = { ...baseRow, value: undefined, unit: undefined, id: "same-row" };
      rows.push(
        { ...common, [field]: value, [alias]: "ignored" },
        { ...common, [field]: value, [alias]: "different-ignored" },
      );
    }
    assert.equal((await importTimeseriesRows("glucose", rows)).length, 4);
    const fallback = { ...baseRow, id: "same-row", value: undefined, unit: undefined, [alias]: "selected" };
    assert.equal((await importTimeseriesRows("glucose", [
      { ...fallback, [field]: null },
      { ...fallback, [field]: undefined, [alias]: "different" },
    ])).length, 2);
  });
}

test("Junction glucose retains distinct revisions for the canonical importer", async () => {
  const records = [
    { ...baseRow, id: "same-row", recordedAt: "2026-04-02T13:00:00Z" },
    { ...baseRow, id: "same-row", recordedAt: "2026-04-02T14:00:00Z" },
  ];
  assert.equal((await importTimeseriesRows("glucose", records)).length, 2);
});

for (const resource of ["caffeine", "water", "mindfulness_minutes"]) {
  test(`Junction ${resource} interval identity retains aliases and falsey values`, async () => {
    const valueAlias = resource === "mindfulness_minutes" ? "mindfulness_minutes" : resource;
    const interval = { timestamp, start: timestamp, end: "2026-04-02T12:05:00.000Z" };
    const records: Record<string, unknown>[] = [];
    for (const value of ["", 0, false, 12]) {
      const row = { ...interval, id: "same-interval", value, unit: "" };
      records.push(
        { ...row, [valueAlias]: 100, valueUnit: "ignored" },
        { ...row, [valueAlias]: 200, valueUnit: "different-ignored" },
      );
    }
    assert.equal((await importTimeseriesRows(resource, records)).length, 4);
    assert.equal((await importTimeseriesRows(resource, [
      { ...interval, value: null, [valueAlias]: 12, start: null, startAt: timestamp },
      { ...interval, value: undefined, [valueAlias]: 12, end: null, end_at: interval.end },
    ])).length, 1);
  });
}

for (const resource of ["blood_oxygen", "stress_level"]) {
  test(`Junction ${resource} retains temporal identity before point alias fields`, async () => {
    const rows = await importTimeseriesRows(resource, [
      { ...baseRow, id: "temporal-row", timeZone: "UTC", observedAt: timestamp },
      { ...baseRow, id: "temporal-row", timeZone: "different", observedAt: "ignored" },
    ]);
    assert.equal(rows.length, 1);
  });
}
