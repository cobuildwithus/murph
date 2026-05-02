const CHANNELS = ["iMessage", "Telegram", "Email"] as const;

const MESSAGES = [
  {
    from: "murph",
    text: "Good morning. Tonight: sauna 20 min at 80°C, then cold shower. Reminder at 8pm?",
  },
  {
    from: "user",
    text: "Sure. I had 2 beers last night — did it mess anything up?",
  },
  {
    from: "murph",
    text: "Your HRV dropped 23% overnight. The research median for 2 drinks is −18%. Your body reacts stronger than average. Worth knowing.",
  },
  {
    from: "user",
    text: "Wow. How’s the experiment overall?",
  },
  {
    from: "murph",
    text: "Still strong. HRV +12% vs baseline, deep sleep +16%. One bad night won’t change the trend. 10 days left.",
  },
] as const;

export function AssistantSection() {
  return (
    <section className="bg-[#2a2520] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1080px]">
        <div className="grid gap-12 lg:grid-cols-[1fr_340px] lg:items-center lg:gap-16">
          <div>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]">
              Your daily assistant
            </span>
            <h2 className="mt-5 max-w-[20ch] font-serif text-[clamp(1.5rem,2.8vw,2rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#f5f0e8]">
              Like texting a friend who reads the research.
            </h2>
            <p className="mt-4 max-w-[36ch] text-base leading-[1.7] text-pretty text-[#f5f0e8]/50">
              Murph reaches out when it matters for your experiment and stays
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

          <div className="mx-auto w-full max-w-[340px]">
            <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-[#f5f0e8]/10 bg-[#f5f0e8] shadow-2xl">
              <div className="flex items-center justify-between bg-[#f5f0e8] px-7 pb-1 pt-3">
                <span className="text-[0.75rem] font-semibold text-[#2d3436]">
                  9:41
                </span>
                <div className="flex items-center gap-1.5">
                  <svg
                    width="13"
                    height="9"
                    viewBox="0 0 16 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="6"
                      width="3"
                      height="6"
                      rx="0.5"
                      fill="#2d3436"
                    />
                    <rect
                      x="4.5"
                      y="4"
                      width="3"
                      height="8"
                      rx="0.5"
                      fill="#2d3436"
                    />
                    <rect
                      x="9"
                      y="1.5"
                      width="3"
                      height="10.5"
                      rx="0.5"
                      fill="#2d3436"
                    />
                    <rect
                      x="13"
                      y="0"
                      width="3"
                      height="12"
                      rx="0.5"
                      fill="#2d3436"
                      opacity="0.25"
                    />
                  </svg>
                  <svg
                    className="translate-y-px"
                    width="22"
                    height="12"
                    viewBox="0 0 16 11"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="0.5"
                      y="0.5"
                      width="13"
                      height="8"
                      rx="1"
                      stroke="#2d3436"
                      strokeWidth="1"
                    />
                    <rect
                      x="14"
                      y="3"
                      width="2"
                      height="3"
                      rx="0.5"
                      fill="#2d3436"
                    />
                    <rect
                      x="1.5"
                      y="1.5"
                      width="11"
                      height="6"
                      rx="0.5"
                      fill="#2d3436"
                    />
                  </svg>
                </div>
              </div>

              <div className="border-b border-[#c4a882]/15 bg-[#f5f0e8] px-5 pb-3 pt-1">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-full bg-[#2a2520]">
                    <span className="text-[0.6875rem] font-semibold text-[#f5f0e8]">
                      M
                    </span>
                  </div>
                  <div>
                    <p className="text-[0.8125rem] font-semibold text-[#2d3436]">
                      Murph
                    </p>
                    <p className="text-[0.625rem] text-[#736a58]">
                      Finnish Sauna Protocol &middot; Day 12
                    </p>
                  </div>
                </div>
              </div>

              <div
                className="flex flex-col gap-2.5 px-4 py-4"
                style={{ minHeight: 420 }}
              >
                {MESSAGES.map((message, index) => (
                  <div
                    key={index}
                    className={`max-w-[82%] ${
                      message.from === "user" ? "ml-auto" : "mr-auto"
                    }`}
                  >
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 ${
                        message.from === "user"
                          ? "rounded-br-sm bg-[#5a6e32] text-white/90"
                          : "rounded-bl-sm bg-white text-[#2d3436]/85"
                      }`}
                    >
                      <p className="text-[0.8125rem] leading-[1.55]">
                        {message.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-[#c4a882]/15 bg-[#f5f0e8] px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-full border border-[#c4a882]/20 bg-white px-4 py-2">
                    <span className="text-[0.8125rem] text-[#736a58]/40">
                      Message Murph...
                    </span>
                  </div>
                  <div className="flex size-8 items-center justify-center rounded-full bg-[#5a6e32]">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M1 7h10M8 4l3 3-3 3"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
