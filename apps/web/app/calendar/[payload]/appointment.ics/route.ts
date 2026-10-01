import { parseCalendarEventPayload } from "@murphai/contracts";

import { buildICalendar } from "@/src/lib/calendar-event";

const CALENDAR_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Disposition": 'inline; filename="appointment.ics"',
  "Content-Type": "text/calendar; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ payload: string }> },
): Promise<Response> {
  const { payload } = await context.params;
  const event = parseCalendarEventPayload(payload);
  if (event === null) {
    return new Response("Calendar invite not found.", {
      headers: CALENDAR_HEADERS,
      status: 404,
    });
  }

  return new Response(buildICalendar(event), { headers: CALENDAR_HEADERS });
}
