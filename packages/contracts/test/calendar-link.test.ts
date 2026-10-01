import { describe, expect, it } from "vitest";

import {
  buildCalendarEventUrl,
  CALENDAR_LINK_URL_MAX_LENGTH,
  CALENDAR_LINK_URL_PREFIX,
  calendarEventV1Schema,
  parseCalendarEventDateTime,
  parseCalendarEventPayload,
} from "../src/calendar-link.ts";

const EVENT = {
  title: "Care appointment",
  startsAt: "2026-10-14T14:30:00-04:00",
  endsAt: "2026-10-14T15:15:00-04:00",
  location: "Downtown Clinic",
  notes: "Bring the current medication list.",
} as const;

describe("calendar link contract", () => {
  it("round-trips one bounded event through a canonical stateless URL", () => {
    const url = buildCalendarEventUrl(EVENT);
    const payload = url.slice(CALENDAR_LINK_URL_PREFIX.length);

    expect(url.length).toBeLessThan(CALENDAR_LINK_URL_MAX_LENGTH);
    expect(parseCalendarEventPayload(payload)).toEqual(EVENT);
  });

  it("keeps the supplied wall time while resolving the UTC instant", () => {
    expect(parseCalendarEventDateTime(EVENT.startsAt)).toEqual({
      day: 14,
      hour: 14,
      instant: Date.parse("2026-10-14T18:30:00.000Z"),
      minute: 30,
      month: 10,
      offset: "-04:00",
      second: 0,
      year: 2026,
    });
  });

  it("rejects reversed intervals and malformed or non-canonical payloads", () => {
    expect(() => calendarEventV1Schema.parse({
      ...EVENT,
      endsAt: EVENT.startsAt,
    })).toThrow("Calendar event end time must be after its start time.");
    expect(parseCalendarEventPayload("not-json")).toBeNull();
    expect(parseCalendarEventPayload("dGVzdA==")).toBeNull();
  });

  it("rejects ambiguous local timestamps and impossible offsets", () => {
    expect(calendarEventV1Schema.safeParse({
      ...EVENT,
      startsAt: "2026-10-14T14:30:00",
    }).success).toBe(false);
    expect(calendarEventV1Schema.safeParse({
      ...EVENT,
      startsAt: "2026-10-14T14:30:00+14:30",
    }).success).toBe(false);
  });

  it("fails at the existing provider URL boundary instead of adding storage", () => {
    expect(() => buildCalendarEventUrl({
      ...EVENT,
      notes: "日".repeat(600),
    })).toThrow("The calendar event exceeds the Messages link limit.");
  });
});
