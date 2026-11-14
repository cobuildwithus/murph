import assert from "node:assert/strict";
import { test } from "vitest";
import { buildJunctionDailyTimeseriesAggregateResourceId, normalizeJunctionSnapshot, selectJunctionSparseCalendarDayRecords, type JunctionSnapshotInput } from "@murphai/importers/device-providers/junction";
import { createJob, createJunctionJobContext, createJunctionProvider, executeJunctionJob } from "./junction-provider.harness.ts";
import { JunctionClient } from "../src/providers/junction-client.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

for (const offsetHours of [8, -8]) {
  for (const includeTarget of [false, true]) {
    test(`SDK intervals preserve calendar selection (offset=${offsetHours}, target=${includeTarget})`, async () => {
      const origin = Date.parse("2026-04-02T00:00:00Z") - offsetHours * 3_600_000;
      const rows = (includeTarget ? [-1, 1, 23, 25] : [-1, 25]).map((hour, index) => ({
        id: index + 1,
        timestamp: new Date(origin + hour * 3_600_000).toISOString(),
        start: new Date(origin + hour * 3_600_000).toISOString(),
        end: new Date(origin + hour * 3_600_000 + 60_000).toISOString(),
        timezone_offset: offsetHours * 3600, unit: "min", value: 1,
      }));
      let imports = 0;
      const provider = createJunctionProvider(async (input) => {
        const url = new URL(readUrl(input));
        if (url.pathname.includes("/user/providers/")) return createJsonResponse({ providers: [{
          id: "synthetic-provider", name: "Garmin", slug: "garmin", status: "connected", resource_availability: { mindfulness_minutes: true },
        }] });
        const date = url.searchParams.get("start_date")!.slice(0, 10);
        return createJsonResponse({ groups: { garmin: [{
          data: rows.filter((row) => row.start.slice(0, 10) === date), source: { provider: "garmin", type: "watch" },
        }] } });
      }, { timeseriesResources: ["mindfulness_minutes"] });
      await executeJunctionJob(provider, createJunctionJobContext({
        now: "2026-04-05T12:00:00Z",
        importSnapshot: async (snapshot) => {
          imports += 1;
          const batch = normalizeJunctionSnapshot(snapshot as JunctionSnapshotInput, { defaultTimeZone: "UTC" });
          const daily = batch.events?.find((event) => event.fields && "metric" in event.fields && event.fields.metric === "mindfulness-minutes");
          assert.equal(daily?.fields && "value" in daily.fields ? daily.fields.value : undefined, includeTarget ? 2 : 0);
          return { durableDeliveryAccepted: true, canonicalEventExternalRefResourceIds: [buildJunctionDailyTimeseriesAggregateResourceId({ dayKey: "2026-04-02", resource: "mindfulness_minutes", sourceProviderSlug: "garmin", sourceType: "watch" })] };
        },
      }), createJob("resource", { calendarRefreshDay: "2026-04-02", resource: "mindfulness_minutes", resourceCategory: "timeseries", sourceProviderSlug: "garmin", sourceType: "watch" }));
      assert.equal(imports, 1);
    });
  }
}
test("grouped interval transport hands on SDK-decoded endpoints as UTC strings", async () => {
  const client = new JunctionClient({
    apiKey: "sk_us_synthetic", environment: "sandbox", region: "us",
    fetchImpl: async () => createJsonResponse({ groups: { garmin: [{
      source: { provider: "garmin", type: "watch" },
      data: [{ timestamp: "2026-04-02T12:00:00Z", start: "2026-04-02T12:00:00Z", end: "2026-04-02T12:01:00Z", timezone_offset: 3600, unit: "min", value: 1 }],
    }] } }),
  });
  const records = await client.listTimeseries({ resource: "mindfulness_minutes", userId: "synthetic-user", windowStart: "2026-04-02T00:00:00Z", windowEnd: "2026-04-03T00:00:00Z", requireStructurallyCompleteCollection: true });
  const row = records[0] as { start: unknown; end: unknown; timezone_offset: unknown };
  assert.equal(row.start, "2026-04-02T12:00:00.000Z");
  assert.equal(row.end, "2026-04-02T12:01:00.000Z");
  assert.equal(row.timezone_offset, 3600);
});

test("calendar selection preserves malformed SDK intervals for strict rejection", () => {
  const row = { sourceProviderSlug: "garmin", sourceType: "watch", start: new Date("2026-04-01T10:00:00Z"), end: new Date("2026-04-01T09:00:00Z"), value: 1, timezoneOffset: 3600 };
  const selected = selectJunctionSparseCalendarDayRecords([row], { dayKey: "2026-04-02", sourceProviderSlug: "garmin" });
  assert.deepEqual(selected, [row]);
  assert.throws(() => normalizeJunctionSnapshot({
    timeseriesWindowKind: "calendar_day",
    strictSparseCalendarRepair: { dayKey: "2026-04-02", resource: "mindfulness_minutes", sourceProviderSlug: "garmin", sourceType: "watch" },
    timeseries: { mindfulness_minutes: JSON.parse(JSON.stringify(selected)) },
  }), (error: unknown) => error instanceof Error && "diagnostic" in error && (error.diagnostic as { reason: string }).reason === "sparse_interval.end_before_start");
});

test("calendar selection keeps endpoint alias precedence with SDK Dates", () => {
  const row = { start: new Date("2026-04-02T12:00:00Z"), end: new Date("2026-04-02T12:01:00Z"), startAt: "2026-04-01T12:00:00Z", endAt: "2026-04-01T12:01:00Z", timezoneOffset: 3600 };
  assert.deepEqual(selectJunctionSparseCalendarDayRecords([row], { dayKey: "2026-04-02", sourceProviderSlug: "garmin" }), [row]);
  assert.deepEqual(selectJunctionSparseCalendarDayRecords([row], { dayKey: "2026-04-01", sourceProviderSlug: "garmin" }), []);
});
