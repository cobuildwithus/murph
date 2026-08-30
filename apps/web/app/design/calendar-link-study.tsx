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
    <div className="grid gap-8" data-design-section="calendar-link" id="calendar-link">
      <div>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Valid invite · phone and desktop
        </p>
        <div className="overflow-hidden border border-border">
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
          Invalid link recovery
        </p>
        <div className="overflow-hidden border border-border">
          <CalendarLinkUnavailable embedded />
        </div>
      </div>
    </div>
  );
}
