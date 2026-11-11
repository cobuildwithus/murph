import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeJunctionSnapshot, JunctionSparseCalendarRepairNormalizationError } from "../src/device-providers/junction.js";

test("calendar day diagnostics distinguish provenance without exposing dates", () => {
  const diagnose = (patch: Record<string, unknown>, defaultTimeZone = "UTC") => {
    try {
      normalizeJunctionSnapshot({
        accountId: "synthetic-account", importedAt: "2026-04-24T12:00:00.000Z",
        timeseriesWindowKind: "calendar_day",
        windowStart: "2026-04-22T00:00:00.000Z", windowEnd: "2026-04-23T00:00:00.000Z",
        strictSparseCalendarRepair: { dayKey: "2026-04-22", resource: "caffeine", sourceProviderSlug: "apple-health-kit", sourceType: "app" },
        timeseries: { caffeine: { groups: { apple_health_kit: [{
          source: { provider: "apple_health_kit", type: "app" },
          data: [{ start: "2026-04-22T02:00:00.000Z", end: "2026-04-22T02:00:00.000Z", value: 0.1, unit: "g", ...patch }],
        }] } } },
      }, { defaultTimeZone });
      return "accepted";
    } catch (error) {
      assert.ok(error instanceof JunctionSparseCalendarRepairNormalizationError);
      return error.diagnostic;
    }
  };
  assert.equal(diagnose({}), "accepted");
  const explicitDay = diagnose({ calendarDate: "2026-04-21" });
  const sourceOffset = diagnose({ timezone_offset: -14400 });
  const outsideWindow = diagnose({ start: "2026-04-21T02:00:00.000Z", end: "2026-04-21T02:00:00.000Z" });
  assert.notEqual(explicitDay, "accepted");
  assert.equal(typeof explicitDay === "object" && explicitDay.dayBasis, "explicit_calendar");
  assert.equal(typeof explicitDay === "object" && explicitDay.utcDayRelation, "equal");
  assert.equal(typeof sourceOffset === "object" && sourceOffset.dayBasis, "source_offset");
  assert.equal(typeof sourceOffset === "object" && sourceOffset.utcDayRelation, "equal");
  assert.equal(typeof outsideWindow === "object" && outsideWindow.dayBasis, "vault_timezone");
  assert.equal(typeof outsideWindow === "object" && outsideWindow.utcDayRelation, "before");
  for (const diagnostic of [explicitDay, sourceOffset, outsideWindow]) {
    assert.equal(typeof diagnostic === "object" && diagnostic.resolvedDayRelation, "before");
    assert.equal(JSON.stringify(diagnostic).includes("2026-"), false);
  }
  const offsetOverridesCalendar = diagnose({ calendarDate: "2026-04-22", timezone_offset: -14400 });
  assert.equal(typeof offsetOverridesCalendar === "object" && offsetOverridesCalendar.dayBasis, "source_offset");
  const offsetTimestamp = diagnose({ start: "2026-04-21T23:00:00-04:00", end: "2026-04-21T23:00:00-04:00" });
  assert.equal(typeof offsetTimestamp === "object" && offsetTimestamp.dayBasis, "timestamp_calendar");
  assert.equal(typeof offsetTimestamp === "object" && offsetTimestamp.utcDayRelation, "equal");
  const nextDay = diagnose({ start: "2026-04-23T02:00:00Z", end: "2026-04-23T02:00:00Z" });
  assert.equal(typeof nextDay === "object" && nextDay.utcDayRelation, "after");
  assert.equal(typeof nextDay === "object" && nextDay.resolvedDayRelation, "after");
  const invalid = diagnose({ start: "invalid" });
  assert.equal(typeof invalid === "object" && invalid.dayBasis, undefined);
  assert.equal(typeof invalid === "object" && invalid.utcDayRelation, undefined);
  assert.equal(typeof explicitDay === "object" && explicitDay.reason, "sparse_interval.day_mismatch");
});
