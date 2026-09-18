import assert from "node:assert/strict";
import { eventRecordSchema } from "@murphai/contracts";
import { test } from "vitest";
import { normalizeJunctionSnapshot } from "../src/index.ts";

test.each([
  ["long_sleep", "main_sleep"],
  ["short_sleep", "short_sleep"],
  ["acknowledged_nap", "nap"],
  ["unknown", "unknown"],
  [undefined, undefined],
] as const)("preserves Junction sleep classification %s through canonical validation", (type, expected) => {
  for (const state of ["tentative", "confirmed", undefined] as const) {
    const payload = normalizeJunctionSnapshot({
      importedAt: "2026-04-10T12:00:00.000Z",
      summaries: { sleep: [{
        id: "synthetic-sleep-session",
        sourceProviderSlug: "garmin",
        calendar_date: "2026-04-10",
        bedtime_start: "2026-04-10T09:00:00.000Z",
        bedtime_end: "2026-04-10T09:45:00.000Z",
        total_sleep_duration: 2280,
        type,
        state,
      }] },
    });
    const session = payload.events?.find((event) => event.kind === "sleep_session");
    assert.ok(session);
    assert.equal(session.fields?.sleepType, expected);
    assert.equal(session.fields?.sleepState, state);
    const { fields, evidenceRoles: _evidenceRoles, ...record } = session;
    const canonical = eventRecordSchema.parse({
      schemaVersion: "murph.event.v1",
      id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1F0",
      ...record,
      ...fields,
    });
    assert.equal(canonical.kind, "sleep_session");
  }
});
