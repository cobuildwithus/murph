import assert from "node:assert/strict";
import { test } from "vitest";
import { buildJunctionDailyTimeseriesAggregateResourceId, normalizeJunctionSnapshot, type JunctionSnapshotInput } from "@murphai/importers/device-providers/junction";
import { createJob, createJunctionJobContext, createJunctionProvider, executeJunctionJob } from "./junction-provider.harness.ts";
import { createJsonResponse, readUrl } from "./helpers.ts";

for (const offsetHours of [8, -8, 24, -24]) {
  test(`sparse calendar refresh collects the complete source day at UTC${offsetHours}`, async () => {
    const dayKey = "2026-04-02";
    const origin = Date.parse(`${dayKey}T00:00:00Z`) - offsetHours * 3_600_000;
    const rows = [-1, 1, 23, 25].map((hour, index) => ({
      id: index + 1,
      start: new Date(origin + hour * 3_600_000).toISOString(),
      end: new Date(origin + hour * 3_600_000 + 60_000).toISOString(),
      timezone_offset: offsetHours * 3600,
      value: 100,
    }));
    const dates: string[] = [];
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname.includes("/user/providers/")) return createJsonResponse({ providers: [{
        id: "provider-garmin-1", name: "Garmin", slug: "garmin", status: "connected", resource_availability: { water: true },
      }] });
      const date = url.searchParams.get("start_date")!.slice(0, 10);
      dates.push(date);
      return createJsonResponse({ groups: { garmin: [{
        data: rows.filter((row) => row.start.slice(0, 10) === date),
        source: { provider: "garmin", type: "watch" },
      }] } });
    }, { timeseriesResources: ["water"] });
    const batches: ReturnType<typeof normalizeJunctionSnapshot>[] = [];
    await executeJunctionJob(provider, createJunctionJobContext({
      now: "2026-04-05T12:00:00Z",
      importSnapshot: async (snapshot) => {
        batches.push(normalizeJunctionSnapshot(snapshot as JunctionSnapshotInput, { defaultTimeZone: "UTC" }));
        return { durableDeliveryAccepted: true, canonicalEventExternalRefResourceIds: [buildJunctionDailyTimeseriesAggregateResourceId({ dayKey, resource: "water", sourceProviderSlug: "garmin", sourceType: "watch" })] };
      },
    }), createJob("resource", { calendarRefreshDay: dayKey, resource: "water", resourceCategory: "timeseries", sourceProviderSlug: "garmin", sourceType: "watch" }));
    assert.equal(batches.length, 1);
    const daily = batches[0]!.events?.filter((event) => event.fields && "metric" in event.fields && event.fields.metric === "water");
    assert.equal(daily?.length, 1);
    assert.equal(daily?.[0]?.dayKey, dayKey);
    assert.equal(daily?.[0]?.fields && "value" in daily[0].fields ? daily[0].fields.value : undefined, 200);
    assert.deepEqual(dates, ["2026-04-01", "2026-04-02", "2026-04-03"]);
  });
}

for (const mode of ["empty", "adjacent", "unavailable", "malformed", "distant", "pagination", "yield", "not_closed"] as const) {
  test(`sparse calendar complete collection handles ${mode} without partial replacement`, async () => {
    let reads = 0;
    let imports = 0;
    const provider = createJunctionProvider(async (input) => {
      const url = new URL(readUrl(input));
      if (url.pathname.includes("/user/providers/")) return createJsonResponse({ providers: [{
        id: "provider-garmin-1", name: "Garmin", slug: "garmin", status: "connected", resource_availability: { water: true },
      }] });
      reads += 1;
      if (mode === "unavailable" && reads === 2) return createJsonResponse({ error: "unavailable" }, 404);
      return createJsonResponse({ ...(mode === "pagination" ? { next_cursor: `page-${reads}` } : {}), groups: { garmin: [{
        data: mode === "malformed" && reads === 2 ? [{ start: "2026-04-02T08:00:00Z", value: 100 }]
          : mode === "distant" && reads === 2 ? [{ start: "2026-04-02T08:00:00Z", end: "2026-04-02T08:01:00Z", calendarDate: "2026-05-02", value: 100 }]
          : mode === "adjacent" && reads === 1 ? [{ start: "2026-04-01T08:00:00Z", end: "2026-04-01T08:01:00Z", value: 100 }] : [],
        source: { provider: "garmin", type: "watch" },
      }] } });
    }, { timeseriesResources: ["water"] });
    const run = () => executeJunctionJob(provider, createJunctionJobContext({
      now: mode === "not_closed" ? "2026-04-03T12:00:00Z" : "2026-04-05T12:00:00Z",
      shouldYield: () => mode === "yield" && reads > 0,
      importSnapshot: async (snapshot) => {
        const batch = normalizeJunctionSnapshot(snapshot as JunctionSnapshotInput);
        imports += 1;
        const daily = batch.events?.find((event) => event.fields && "metric" in event.fields && event.fields.metric === "water");
        assert.equal(daily?.fields && "value" in daily.fields ? daily.fields.value : undefined, 0);
        return { durableDeliveryAccepted: true, canonicalEventExternalRefResourceIds: [buildJunctionDailyTimeseriesAggregateResourceId({ dayKey: "2026-04-02", resource: "water", sourceProviderSlug: "garmin", sourceType: "watch" })] };
      },
    }), createJob("resource", { calendarRefreshDay: "2026-04-02", resource: "water", resourceCategory: "timeseries", sourceProviderSlug: "garmin", sourceType: "watch" }));
    if (mode === "malformed" || mode === "distant" || mode === "unavailable" || mode === "pagination") {
      await assert.rejects(run, (error: unknown) => error instanceof Error && (
        mode === "pagination" ? "code" in error && error.code === "JUNCTION_API_WINDOW_TOO_LARGE"
          : mode !== "unavailable" ? error.name === "JunctionSparseCalendarRepairNormalizationError"
            : "code" in error && error.code === "JUNCTION_CALENDAR_REFRESH_UNAVAILABLE"
      ));
    } else {
      const result = await run();
      assert.equal(result.scheduledJobs?.length ?? 0, (mode === "empty" || mode === "adjacent") ? 0 : 1);
      if (mode === "not_closed") assert.equal(result.scheduledJobs?.[0]?.availableAt, "2026-04-04T00:00:00.000Z");
    }
    assert.equal(imports, (mode === "empty" || mode === "adjacent") ? 1 : 0);
    assert.equal(reads, mode === "not_closed" ? 0 : mode === "yield" ? 1 : mode === "unavailable" ? 2 : 3);
  });
}
