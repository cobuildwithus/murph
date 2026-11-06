import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import type { CalendarEventV1 } from "@murphai/contracts";

import {
  LINK_PAGE_GOLD,
  LINK_PAGE_PILL_CLASS,
  LinkPageFrame,
  LinkPageScreen,
  LinkPageSurface,
  linkPageHeadline,
} from "@/src/components/link-page/link-page-shell";
import {
  presentCalendarEvent,
  type CalendarEventPresentation,
} from "@/src/lib/calendar-event";

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
    <CalendarFrame embedded={embedded} state="ready">
      <LinkPageScreen
        actions={
          <CalendarHandoff
            autoOpen={autoOpen}
            downloadHref={downloadHref}
            payload={payload}
          />
        }
        announceDetail={false}
        detail="Your calendar app will ask you to confirm before anything is added."
        title={linkPageHeadline(event.title)}
      >
        <CalendarSheet presentation={presentation} />
        <div className="mt-5 flex min-w-0 flex-col items-center gap-0.5 text-center">
          <p className="text-[18px] font-semibold leading-6">
            {presentation.timeLabel}{" "}
            <span className="text-base font-medium leading-[22px] text-[#FFFCF6]/60">
              {presentation.timeZoneLabel}
            </span>
          </p>
          {event.location ? (
            <p className="w-full text-base font-medium leading-[22px] text-[#FFFCF6]/60 [overflow-wrap:anywhere]">
              {event.location}
            </p>
          ) : null}
          {event.notes ? (
            <p className="w-full whitespace-pre-wrap text-base font-medium leading-[22px] text-[#FFFCF6]/60 [overflow-wrap:anywhere]">
              {event.notes}
            </p>
          ) : null}
        </div>
      </LinkPageScreen>
    </CalendarFrame>
  );
}

export function CalendarLinkUnavailable({ embedded = false }: { embedded?: boolean }) {
  return (
    <CalendarFrame embedded={embedded} state="unavailable">
      <LinkPageScreen
        actions={
          // Messages has no deep link into a chat from here, so this can only
          // open the app itself.
          <a className={LINK_PAGE_PILL_CLASS} href="sms:">
            <MessageCircle aria-hidden="true" className="size-5" />
            Open Messages
          </a>
        }
        detail="The link may be incomplete. Ask Murph to make a fresh calendar link."
        title="This invite can’t be opened."
      />
    </CalendarFrame>
  );
}

function CalendarFrame({
  children,
  embedded,
  state,
}: {
  children: ReactNode;
  embedded: boolean;
  state: "ready" | "unavailable";
}) {
  const Frame = embedded ? LinkPageSurface : LinkPageFrame;

  return (
    <Frame>
      <div className="flex flex-1 flex-col" data-calendar-link-state={state}>
        {children}
      </div>
    </Frame>
  );
}

/** A page off a wall calendar: the object on an invite to one day. */
function CalendarSheet({
  presentation,
}: {
  presentation: CalendarEventPresentation;
}) {
  return (
    <div
      aria-label={presentation.dateLabel}
      className="mx-auto flex w-[188px] shrink-0 flex-col items-center overflow-hidden rounded-[18px] bg-[#FFFCF6]"
      role="img"
    >
      <span
        className="flex h-10 w-full items-center justify-center font-mono text-[13px] uppercase leading-[18px] tracking-[0.22em] text-[#3B2A12]"
        style={{ background: LINK_PAGE_GOLD }}
      >
        {presentation.month}
      </span>
      <span className="pt-2 font-serif text-[92px] font-semibold leading-[100px] tracking-[-0.03em] text-[#2D3436]">
        {presentation.day}
      </span>
      <span className="pb-4 text-[15px] font-semibold leading-5 text-[#736A58]">
        {presentation.weekday}
      </span>
    </div>
  );
}
