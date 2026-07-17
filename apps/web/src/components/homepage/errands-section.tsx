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

const CONNECTORS = [
  { name: "Google Calendar", tag: "calendar" },
  { name: "Gmail & Outlook", tag: "email" },
  { name: "Amazon & Instacart", tag: "shopping" },
  { name: "Clinician lookup", tag: "health" },
  { name: "Weather", tag: "daily" },
  { name: "Notion & Drive", tag: "notes" },
] as const;

function ConnectorsPanel() {
  return (
    <aside className="lg:border-l lg:border-[#c4a882]/40 lg:pl-10">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#736a58]">
        Also plugs into
      </p>
      <ul className="mt-5">
        {CONNECTORS.map((connector) => (
          <li
            key={connector.name}
            className="flex items-baseline justify-between gap-4 border-b border-[#c4a882]/25 py-3"
          >
            <span className="text-[0.9375rem] leading-[1.3] text-[#2d3436]">
              {connector.name}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#736a58]">
              {connector.tag}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[0.8125rem] leading-[1.5] text-[#736a58]">
        Plus hundreds more, with new ones added every week.
      </p>
    </aside>
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
            Murph has a browser and a phone.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.7] text-[#3a322a]">
            It shops the web and sits on hold so you don&apos;t have to.
            Nothing gets bought or booked without your say-so.
          </p>
        </div>

        <div className="mt-16 grid gap-14 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-16">
          <div className="w-full max-w-[640px]">
            {TIMELINE.map((event) => (
              <TimelineEvent event={event} key={event.time + event.kind} />
            ))}

            <div className="grid grid-cols-[52px_17px_1fr] gap-x-3 sm:grid-cols-[64px_17px_1fr] sm:gap-x-5">
              <span />
              <span />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#8a6428]">
                One text. Seventeen minutes. Zero apps opened.
              </p>
            </div>
          </div>

          <ConnectorsPanel />
        </div>
      </div>
    </section>
  );
}
