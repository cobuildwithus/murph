import Image from "next/image";

import {
  DEFAULT_MURPH_HEADSHOT,
  MurphHeadshotAvatar,
} from "./murph-headshot-avatar";

const TIMELINE = [
  {
    time: "2:14 PM",
    kind: "user",
    text: "running low on omega-3, and my tooth's been aching. can you handle it?",
  },
  {
    time: "2:15 PM",
    kind: "activity",
    text: "Opened a browser · compared omega-3 prices at three stores",
  },
  {
    time: "2:19 PM",
    kind: "activity",
    text: "Called Cedar Dental · waited on hold 9 minutes",
  },
  {
    time: "2:29 PM",
    kind: "activity",
    text: "Booked a cleaning, Thursday 10:15 AM · added to your calendar",
  },
  {
    time: "2:31 PM",
    kind: "murph",
    text: "Both handled. Dentist is Thursday at 10:15. The omega-3 refill came to $23.79 with a subscribe discount. Approve and it ships.",
  },
  {
    time: "2:31 PM",
    kind: "user",
    text: "approved 👍",
  },
] as const;

function TimelineEvent({
  event,
}: {
  event: (typeof TIMELINE)[number];
}) {
  return (
    <div className="grid grid-cols-[52px_17px_1fr] gap-x-3 sm:grid-cols-[64px_17px_1fr] sm:gap-x-5">
      <span className="pt-0.5 text-right font-mono text-[10px] tabular-nums text-[#736a58]">
        {event.time}
      </span>

      <div className="relative flex justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-[#c4a882]/40"
        />
        <span
          aria-hidden="true"
          className={
            event.kind === "activity"
              ? "relative mt-1 size-[9px] rounded-full bg-[#f5f0e8] ring-2 ring-[#c4a882]"
              : "relative mt-1 size-[9px] rounded-full bg-[#2c7a3f]"
          }
        />
      </div>

      <div className="pb-8">
        {event.kind === "user" ? (
          <div className="w-fit max-w-[44ch] rounded-2xl rounded-tl-[6px] bg-[#2c7a3f] px-4 py-2.5 text-[0.9375rem] leading-[1.45] text-white shadow-[0_8px_24px_-6px_rgba(60,40,20,0.3)]">
            {event.text}
          </div>
        ) : null}
        {event.kind === "murph" ? (
          <div className="w-fit max-w-[46ch] rounded-2xl rounded-tl-[6px] bg-white px-4 py-2.5 text-[0.9375rem] leading-[1.45] text-[#2d3436] shadow-[0_8px_24px_-6px_rgba(60,40,20,0.2)]">
            {event.text}
          </div>
        ) : null}
        {event.kind === "activity" ? (
          <p className="pt-0.5 font-mono text-[11px] leading-[1.6] tracking-[0.02em] text-[#635a48]">
            {event.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DoorstepArtifact() {
  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      <div className="overflow-hidden rounded-[1.5rem] ring-1 ring-black/[0.06] shadow-[0_30px_80px_-35px_rgba(60,40,20,0.5)]">
        <Image
          alt="A delivery box on the doorstep, left after a single text to Murph"
          className="h-auto w-full object-cover"
          height={1536}
          sizes="(min-width: 1024px) 400px, 100vw"
          src="/doorstep-delivery.jpg"
          width={1024}
        />
      </div>

      <div className="absolute -top-4 left-4 flex items-end gap-2 sm:-left-6">
        <MurphHeadshotAvatar
          className="size-8 shrink-0 shadow-[0_8px_24px_-6px_rgba(60,40,20,0.35)] ring-2 ring-white"
          src={DEFAULT_MURPH_HEADSHOT}
        />
        <div className="rounded-2xl rounded-bl-[6px] bg-white px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-[#2d3436] shadow-[0_12px_32px_-10px_rgba(60,40,20,0.4)]">
          📦 Omega-3 refill, left at your door.
        </div>
      </div>
    </div>
  );
}

export function ErrandsSection() {
  return (
    <section className="bg-[#f5f0e8] px-4 py-20 sm:px-8 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[720px]">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Errands, handled
          </p>
          <h2 className="mt-4 font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#2d3436]">
            Murph can call anyone and order anything.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.7] text-[#3a322a]">
            It shops the web and sits on hold so you don&apos;t have to.
            Nothing gets bought or booked without your say-so.
          </p>
        </div>

        <div className="mt-16 grid gap-14 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:gap-16">
          <div className="w-full max-w-[640px]">
            {TIMELINE.map((event) => (
              <TimelineEvent event={event} key={event.time + event.kind} />
            ))}

            <div className="grid grid-cols-[52px_17px_1fr] gap-x-3 sm:grid-cols-[64px_17px_1fr] sm:gap-x-5">
              <span />
              <span />
              <div>
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#8a6428]">
                  One text. Seventeen minutes. Zero apps opened.
                </p>
                <p className="mt-4 max-w-[52ch] text-[0.875rem] leading-[1.6] text-[#736a58]">
                  Also plugs into Google Calendar, Gmail, Amazon, Instacart,
                  clinician search, and hundreds more.
                </p>
              </div>
            </div>
          </div>

          <DoorstepArtifact />
        </div>
      </div>
    </section>
  );
}
