import type { MurphHeadshotSrc } from "./murph-headshot-avatar";

import { PhoneMock, type PhoneMessage } from "./phone-mock";

const CHANNELS = ["iMessage", "Telegram", "Email"] as const;

const MESSAGES: ReadonlyArray<PhoneMessage> = [
  {
    from: "murph",
    text: "Good morning. Tonight: sauna 20 min at 80°C, then cold shower. Reminder at 8pm?",
  },
  {
    from: "user",
    text: "Sure. How’s the experiment overall?",
  },
  {
    from: "murph",
    text: "Strong. HRV +12% vs baseline, deep sleep +16%. 10 days left.",
  },
];

export function AssistantSection({
  murphHeadshotSrc,
}: {
  murphHeadshotSrc: MurphHeadshotSrc;
}) {
  return (
    <section className="bg-[#2a2520] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1080px]">
        <div className="grid gap-12 lg:grid-cols-[1fr_300px] lg:items-center lg:gap-16">
          <div>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]">
              Your daily assistant
            </span>
            <h2 className="mt-5 max-w-[18ch] font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-[#f5f0e8]">
              Like texting a friend who reads the research.
            </h2>
            <p className="mt-5 max-w-[36ch] text-[0.9375rem] leading-[1.75] text-pretty text-[#f5f0e8]/55 sm:text-base">
              Murph reaches out when it matters and stays
              quiet when it doesn&apos;t. No app to open.
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              {CHANNELS.map((channel) => (
                <span
                  key={channel}
                  className="rounded-full border border-[#f5f0e8]/10 px-3.5 py-1.5 text-[0.8125rem] text-[#f5f0e8]/55"
                >
                  {channel}
                </span>
              ))}
            </div>
          </div>

          <div className="mx-auto w-full max-w-[300px]">
            <PhoneMock
              conversationHeight={470}
              messages={MESSAGES}
              murphHeadshotSrc={murphHeadshotSrc}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
