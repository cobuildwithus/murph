import { parseCalendarEventPayload } from "@murphai/contracts";
import { notFound } from "next/navigation";

import { CalendarEventPage } from "@/src/components/calendar/calendar-event-page";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload } = await params;
  const event = parseCalendarEventPayload(payload);
  if (event === null) {
    notFound();
  }

  return (
    <CalendarEventPage
      downloadHref={`/calendar/${payload}/appointment.ics`}
      event={event}
      payload={payload}
    />
  );
}
