import Image from "next/image";

import type { CalendarEventV1 } from "@murphai/contracts";

import { presentCalendarEvent } from "@/src/lib/calendar-event";
import { cn } from "@/src/lib/utils";

import { CalendarHandoff } from "./calendar-handoff";

export function CalendarEventPage({
  autoOpen = true,
  downloadHref,
  embedded = false,
  event,
  payload,
}: {
  autoOpen?: boolean;
  downloadHref: string;
  embedded?: boolean;
  event: CalendarEventV1;
  payload: string;
}) {
  const presentation = presentCalendarEvent(event);

  return (
    <main
      className={cn(
        "bg-[#f7f3e9] text-[#19231d]",
        embedded ? "min-h-[680px]" : "min-h-svh",
      )}
      data-calendar-link-state="ready"
    >
      <div className="mx-auto flex min-h-[inherit] w-full max-w-5xl flex-col px-5 py-7 sm:px-10 sm:py-10 lg:px-14">
        <CalendarHeader />

        <div className="flex flex-1 flex-col justify-center py-14 sm:py-18">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#315a40]">
            Calendar invite
          </p>
          <h1 className="mt-5 max-w-3xl font-serif text-5xl font-medium leading-[0.95] tracking-[-0.045em] text-balance sm:text-7xl lg:text-8xl">
            {event.title}
          </h1>

          <div className="mt-10 grid border-y border-[#d8d1c5] sm:grid-cols-[112px_1fr]">
            <div className="flex flex-row items-baseline gap-2 border-b border-[#d8d1c5] py-5 sm:flex-col sm:items-center sm:justify-center sm:gap-0 sm:border-r sm:border-b-0 sm:pr-6">
              <span className="text-[11px] font-bold tracking-[0.12em] text-[#8d443b]">
                {presentation.month}
              </span>
              <strong className="font-serif text-4xl font-medium leading-none">
                {presentation.day}
              </strong>
            </div>
            <dl className="grid gap-3 py-5 sm:pl-7">
              <EventFact label="Date" value={presentation.dateLabel} />
              <EventFact
                label="Time"
                value={`${presentation.startsLabel}–${presentation.endsLabel}`}
              />
              <EventFact label="Zone" value={presentation.timeZoneLabel} />
              {event.location ? (
                <EventFact label="Where" value={event.location} />
              ) : null}
            </dl>
          </div>

          {event.notes ? (
            <div className="mt-6 max-w-2xl">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#667168]">
                Notes
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#4e5b52]">
                {event.notes}
              </p>
            </div>
          ) : null}
        </div>

        <CalendarHandoff
          autoOpen={autoOpen}
          downloadHref={downloadHref}
          payload={payload}
        />
      </div>
    </main>
  );
}

export function CalendarLinkUnavailable({ embedded = false }: { embedded?: boolean }) {
  return (
    <main
      className={cn(
        "bg-[#f7f3e9] text-[#19231d]",
        embedded ? "min-h-[520px]" : "min-h-svh",
      )}
      data-calendar-link-state="unavailable"
    >
      <div className="mx-auto flex min-h-[inherit] w-full max-w-5xl flex-col px-5 py-7 sm:px-10 sm:py-10 lg:px-14">
        <CalendarHeader />
        <div className="my-auto max-w-3xl py-16">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8d443b]">
            Calendar link unavailable
          </p>
          <h1 className="mt-5 font-serif text-5xl font-medium leading-[0.95] tracking-[-0.045em] text-balance sm:text-7xl">
            This invite can’t be opened.
          </h1>
          <p className="mt-6 max-w-lg text-sm leading-6 text-[#667168]">
            The link may be incomplete. Return to your conversation and ask
            Murph to make a fresh calendar link.
          </p>
        </div>
      </div>
    </main>
  );
}

function CalendarHeader() {
  return (
    <header className="flex items-center justify-between gap-5">
      <Image alt="Murph" height={25} priority src="/logo.svg" width={112} />
      <p className="flex items-center gap-2 text-[11px] text-[#667168]">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[#315a40]" />
        Nothing is added yet
      </p>
    </header>
  );
}

function EventFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[62px_1fr] items-baseline gap-3">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#667168]">
        {label}
      </dt>
      <dd className="text-sm font-semibold text-[#19231d]">{value}</dd>
    </div>
  );
}
