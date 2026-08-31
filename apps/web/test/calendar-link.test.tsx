import { Buffer } from "node:buffer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildCalendarEventUrl,
  CALENDAR_LINK_URL_PREFIX,
  calendarEventV1Bounds,
} from "@murphai/contracts";

import {
  CalendarEventPage,
  CalendarLinkUnavailable,
} from "../src/components/calendar/calendar-event-page";
import { buildICalendar } from "../src/lib/calendar-event";

const EVENT = {
  title: "Care, appointment; follow-up",
  startsAt: "2026-10-14T14:30:00-04:00",
  endsAt: "2026-10-14T15:15:00-04:00",
  location: "Downtown Clinic",
  notes: "Bring the current medication list.\nAsk about café options. ".repeat(3).trim(),
} as const;

describe("calendar link Web experience", () => {
  it("renders the event, honest confirmation copy, and one calendar action", () => {
    const url = buildCalendarEventUrl(EVENT);
    const payload = url.slice(CALENDAR_LINK_URL_PREFIX.length);
    const markup = renderToStaticMarkup(
      <CalendarEventPage
        autoOpen={false}
        downloadHref={`/calendar/${payload}/appointment.ics`}
        event={EVENT}
        payload={payload}
      />,
    );

    expect(markup).toContain("Care, appointment; follow-up");
    expect(markup).toContain("Wednesday, October 14, 2026");
    expect(markup).toContain("2:30 PM–3:15 PM");
    expect(markup).toContain("UTC−04:00");
    expect(markup).toContain("Nothing is added yet");
    expect(markup).toContain(
      "Your calendar app will ask you to confirm before anything is added.",
    );
    expect(markup.match(/Add to Calendar/gu)).toHaveLength(1);
    expect(markup).toContain(`/calendar/${payload}/appointment.ics`);
  });

  it("wraps contract-valid unbroken event text on narrow screens", () => {
    const event = {
      ...EVENT,
      title: "T".repeat(calendarEventV1Bounds.title),
      location: "L".repeat(calendarEventV1Bounds.location),
      notes: "N".repeat(calendarEventV1Bounds.notes),
    };
    const url = buildCalendarEventUrl(event);
    const payload = url.slice(CALENDAR_LINK_URL_PREFIX.length);
    const markup = renderToStaticMarkup(
      <CalendarEventPage
        autoOpen={false}
        downloadHref={`/calendar/${payload}/appointment.ics`}
        event={event}
        payload={payload}
      />,
    );

    expect(markup).toMatch(
      new RegExp(`class="[^"]*\\[overflow-wrap:anywhere\\][^"]*">${event.title}`, "u"),
    );
    expect(markup).toMatch(
      new RegExp(`class="[^"]*\\[overflow-wrap:anywhere\\][^"]*">${event.location}`, "u"),
    );
    expect(markup).toMatch(
      new RegExp(`class="[^"]*\\[overflow-wrap:anywhere\\][^"]*">${event.notes}`, "u"),
    );
    expect(markup).toContain("grid-cols-[62px_minmax(0,1fr)]");
  });

  it("renders a direct recovery state without exposing parser details", () => {
    const markup = renderToStaticMarkup(<CalendarLinkUnavailable />);
    expect(markup).toContain("This invite can’t be opened.");
    expect(markup).toContain("ask Murph to make a fresh calendar link");
    expect(markup).not.toContain("payload");
  });

  it("emits UTC iCalendar with escaped text, CRLF, and UTF-8 line folding", () => {
    const calendar = buildICalendar(EVENT, new Date("2026-08-28T18:00:00.000Z"));
    const lines = calendar.split("\r\n");

    expect(calendar).toContain("DTSTAMP:20260828T180000Z\r\n");
    expect(calendar).toContain("DTSTART:20261014T183000Z\r\n");
    expect(calendar).toContain("DTEND:20261014T191500Z\r\n");
    expect(calendar).toContain("SUMMARY:Care\\, appointment\\; follow-up\r\n");
    expect(calendar).toContain("Ask about café options.");
    expect(calendar).not.toMatch(/(^|[^\r])\n/u);
    expect(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("serves the calendar resource with private import headers", async () => {
    const url = buildCalendarEventUrl(EVENT);
    const payload = url.slice(CALENDAR_LINK_URL_PREFIX.length);
    const { GET } = await import(
      "../app/calendar/[payload]/appointment.ics/route"
    );
    const response = await GET(new Request(`${url}/appointment.ics`), {
      params: Promise.resolve({ payload }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="appointment.ics"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("BEGIN:VEVENT\r\n");
  });

  it("returns a plain 404 for an invalid calendar resource", async () => {
    const { GET } = await import(
      "../app/calendar/[payload]/appointment.ics/route"
    );
    const response = await GET(
      new Request("https://www.withmurph.ai/calendar/nope/appointment.ics"),
      { params: Promise.resolve({ payload: "nope" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Calendar invite not found.");
  });
});
