import { buildCalendarEventUrl } from "@murphai/contracts";

import {
  CalendarEventPage,
  CalendarLinkUnavailable,
} from "@/src/components/calendar/calendar-event-page";

const EVENT = {
  title: "Care appointment",
  startsAt: "2026-10-14T14:30:00-04:00",
  endsAt: "2026-10-14T15:15:00-04:00",
  location: "Downtown Clinic",
  notes: "Bring the current medication list.",
} as const;

export function CalendarLinkStudy() {
  const payload = buildCalendarEventUrl(EVENT).split("/").at(-1) ?? "";

  return (
    <div className="grid gap-8 lg:grid-cols-2" data-design-section="calendar-link" id="calendar-link">
      <div>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          The invite · a page off the calendar
        </p>
        <div className="flex min-h-[46rem] max-w-[402px] flex-col overflow-hidden rounded-[2rem] bg-[#1C1915]">
          <CalendarEventPage
            autoOpen={false}
            downloadHref="#calendar-link"
            embedded
            event={EVENT}
            payload={payload}
          />
        </div>
      </div>
      <div>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Broken link
        </p>
        <div className="flex min-h-[46rem] max-w-[402px] flex-col overflow-hidden rounded-[2rem] bg-[#1C1915]">
          <CalendarLinkUnavailable embedded />
        </div>
      </div>
    </div>
  );
}
