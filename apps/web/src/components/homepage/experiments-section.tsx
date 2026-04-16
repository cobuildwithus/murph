const DOMAINS = [
  {
    domain: "Sleep",
    examples: "deep sleep, circadian rhythm",
  },
  {
    domain: "Recovery",
    examples: "HRV, resting heart rate, sauna",
  },
  {
    domain: "Nutrition",
    examples: "meal timing, protein",
  },
  {
    domain: "Supplements",
    examples: "magnesium, creatine, omega-3",
  },
  {
    domain: "Exercise",
    examples: "zone 2, strength, mobility",
  },
  {
    domain: "Breathwork",
    examples: "cold exposure, box breathing",
  },
] as const;

const METRICS = [
  {
    change: "+12.0%",
    label: "HRV",
    unit: "ms",
    value: "52.1",
  },
  {
    change: "-3.7%",
    label: "Resting HR",
    unit: "bpm",
    value: "61.8",
  },
  {
    change: "+15.9%",
    label: "Deep sleep",
    unit: "",
    value: "1h42m",
  },
] as const;

export function ExperimentsSection() {
  return (
    <section className="bg-[#ede3d0] px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1080px]">
        <div className="grid gap-10 lg:grid-cols-[1fr_480px] lg:items-center lg:gap-16">
          <div>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#635a48]">
              The experiments
            </span>
            <h2 className="mt-4 max-w-[20ch] font-serif text-[clamp(1.5rem,2.5vw,2rem)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#2d3436]">
              40+ experiments across six domains.
            </h2>
            <p className="mt-4 max-w-[36ch] text-[0.9375rem] leading-[1.7] text-pretty text-[#635a48]">
              Each one links to published research, not random internet advice.
              Run it for 2–4 weeks, see what changed.
            </p>

            <div className="mt-8 grid grid-cols-2 gap-2.5">
              {DOMAINS.map(({ domain, examples }) => (
                <div
                  key={domain}
                  className="rounded-xl border border-[#c4a882]/15 bg-[#f5f0e8] px-4 py-3"
                >
                  <p className="text-sm font-semibold text-[#2d3436]">
                    {domain}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] leading-[1.5] text-[#736a58]">
                    {examples}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#635a48]">
              Your experiment dashboard
            </p>
            <div className="rounded-2xl border border-[#c4a882]/15 bg-[#fffcf6] p-6 sm:p-7">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-serif text-[1.125rem] font-semibold text-[#2d3436]">
                    Finnish Sauna Protocol
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-[#736a58]">
                    Recovery &middot; 21 days &middot; Day 8
                  </p>
                </div>
                <span className="rounded-full bg-[#5a6e32]/10 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[#5a6e32]">
                  Active
                </span>
              </div>

              <div className="mt-5">
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="font-mono font-medium uppercase tracking-[0.1em] text-[#5a6e32]">
                    Baseline &middot; 7d &#10003;
                  </span>
                  <span className="font-mono font-medium uppercase tracking-[0.1em] text-[#2d3436]">
                    Active &middot; Day 1 of 14
                  </span>
                  <span className="ml-auto font-mono uppercase tracking-[0.1em] text-[#736a58]/40">
                    Analysis
                  </span>
                </div>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#c4a882]/10">
                  <div className="w-[33%] rounded-full bg-[#5a6e32]" />
                  <div className="w-[5%] bg-[#5a6e32]/30" />
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-[#f5f0e8]/70 px-5 py-4">
                <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
                  Next step &middot; Today evening
                </span>
                <p className="mt-1.5 text-[0.9375rem] font-semibold text-[#2d3436]">
                  Sauna session &middot; 15–20 min @ 80–100°C
                </p>
                <p className="mt-1 text-[0.8125rem] text-[#736a58]">
                  Stay hydrated, replace electrolytes after &middot; Session 2
                  of 3 this week
                </p>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {METRICS.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-xl border border-[#c4a882]/10 px-4 py-3.5"
                  >
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
                      {metric.label}
                    </span>
                    <p className="mt-1.5 font-serif text-[1.35rem] font-semibold leading-none tracking-tight text-[#2d3436]">
                      {metric.value}
                      {metric.unit ? (
                        <span className="ml-0.5 text-[0.75rem] font-normal text-[#736a58]">
                          {metric.unit}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1.5 text-[0.75rem] text-[#5a6e32]">
                      {metric.change} vs baseline
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-[#c4a882]/10 px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
                    HRV trend &middot; 21 days
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-[0.6875rem] text-[#736a58]/50">
                      <span className="inline-block h-px w-3 border-t border-dashed border-[#c4a882]" />{" "}
                      Baseline
                    </span>
                    <span className="flex items-center gap-1.5 text-[0.6875rem] text-[#736a58]">
                      <span className="inline-block h-0.5 w-3 rounded-full bg-[#5a6e32]" />{" "}
                      Active
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <svg
                    viewBox="0 0 380 50"
                    fill="none"
                    className="w-full"
                    aria-hidden="true"
                  >
                    <rect
                      x="0"
                      y="0"
                      width="120"
                      height="50"
                      fill="#d4c4a8"
                      opacity="0.06"
                      rx="3"
                    />
                    <path
                      d="M10 35 L30 33 L50 36 L70 32 L90 34 L110 33"
                      stroke="#d4c4a8"
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                    />
                    <path
                      d="M120 33 L145 30 L170 27 L195 23 L220 25 L245 20 L270 18 L295 19 L320 15 L345 13 L370 11"
                      stroke="#5a6e32"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <circle cx="370" cy="11" r="3" fill="#5a6e32" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
