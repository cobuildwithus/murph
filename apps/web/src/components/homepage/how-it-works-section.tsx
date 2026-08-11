const SYNC_DEVICES: ReadonlyArray<{
  connected?: boolean;
  name: string;
}> = [
  { connected: true, name: "Oura" },
  { name: "WHOOP" },
  { name: "Garmin" },
  { name: "Fitbit" },
];

const CHAT_INPUTS = ["Meals", "Supplements", "Workouts"] as const;
const UPLOAD_INPUTS = ["Blood panels", "Body metrics"] as const;

const DOMAINS = [
  { examples: "deep sleep, circadian rhythm", n: 8, name: "Sleep" },
  { examples: "HRV, resting HR, sauna", n: 9, name: "Recovery" },
  { examples: "meal timing, protein", n: 7, name: "Nutrition" },
  { examples: "magnesium, creatine, omega-3", n: 6, name: "Supplements" },
  { examples: "zone 2, strength, mobility", n: 6, name: "Exercise" },
  { examples: "cold exposure, box breathing", n: 4, name: "Breathwork" },
] as const;

const METRICS = [
  { change: "+12.0%", label: "HRV", unit: "ms", value: "52.1" },
  { change: "-3.7%", label: "Resting HR", unit: "bpm", value: "61.8" },
  { change: "+15.9%", label: "Deep sleep", unit: "", value: "1h42m" },
] as const;

export function HowItWorksSection() {
  return (
    <section
      id="how"
      className="bg-[#f5f0e8] px-5 py-16 sm:px-10 lg:px-16 lg:py-24"
    >
      <div className="mx-auto max-w-[1080px]">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#5a6e32]">
          How it works
        </span>
        <h2 className="mt-5 max-w-[20ch] font-serif text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[#2d3436]">
          Improve your health, one experiment at a time.
        </h2>
        <p className="mt-5 max-w-[48ch] text-base leading-[1.7] text-pretty text-[#635a48]">
          Sync your biomarkers. Run an experiment. See what changes.
        </p>

        <div className="mt-12 grid gap-4 sm:gap-5 lg:mt-14 md:grid-cols-12">
          <ConnectCard />
          <BrowseCard />
          <RunCard />
          <LearnCard />
        </div>

        <p className="mx-auto mt-8 max-w-[72ch] text-center text-xs leading-[1.6] text-[#736a58]">
          Illustrative examples. Changes in personal data can have many causes
          and do not establish that an intervention produced the result.
        </p>
      </div>
    </section>
  );
}

function StepBadge({
  badgeClass,
  n,
  title,
}: {
  badgeClass: string;
  n: string;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={`inline-flex size-8 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${badgeClass}`}
      >
        {n}
      </span>
      <h3 className="font-serif text-[1.25rem] font-semibold text-[#2d3436]">
        {title}
      </h3>
    </div>
  );
}

function ConnectCard() {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-[#c4a882]/15 bg-[#fffcf6] p-7 md:col-span-5">
      <StepBadge
        badgeClass="bg-[#c4a882]/25 text-[#5a4d3a]"
        n="01"
        title="Connect"
      />

      <div className="flex-1 space-y-4">
        {/* --- Sync --- */}
        <div>
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Sync
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SYNC_DEVICES.map((d) => (
              <span
                key={d.name}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium ${
                  d.connected
                    ? "border border-[#5a6e32]/30 bg-[#f5f0e8] text-[#2d3436]"
                    : "border border-[#c4a882]/15 bg-[#f5f0e8]/50 text-[#736a58]"
                }`}
              >
                {d.connected ? (
                  <span className="size-1.5 rounded-full bg-[#5a6e32]" />
                ) : null}
                {d.name}
              </span>
            ))}
          </div>
        </div>

        {/* --- Text Murph --- */}
        <div>
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Text Murph
          </span>
          <div className="mt-1.5 space-y-1">
            {CHAT_INPUTS.map((label) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-lg border border-[#c4a882]/15 bg-[#f5f0e8]/50 px-3 py-2"
              >
                <span className="text-[0.75rem] text-[#736a58]">&rsaquo;</span>
                <span className="text-[0.8125rem] text-[#2d3436]">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* --- Upload --- */}
        <div>
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Upload
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {UPLOAD_INPUTS.map((label) => (
              <span
                key={label}
                className="inline-flex rounded-lg border border-dashed border-[#c4a882]/30 bg-[#f5f0e8]/30 px-3 py-1.5 text-[0.8125rem] text-[#736a58]"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BrowseCard() {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-[#7a8c6e]/20 bg-[#fffcf6] p-7 md:col-span-7">
      <StepBadge
        badgeClass="bg-[#7a8c6e]/20 text-[#3d5028]"
        n="02"
        title="Browse the library"
      />
      <div className="flex-1">
        <div className="mb-4 flex items-baseline gap-3 text-[#2d3436]">
          <span className="font-serif text-[2rem] font-semibold leading-none tracking-tight">
            40+
          </span>
          <span className="text-[0.8125rem] text-[#736a58]">
            experiments · 6 domains
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {DOMAINS.map((d) => (
            <div
              key={d.name}
              className="rounded-xl border border-[#c4a882]/15 bg-[#f5f0e8]/60 px-3.5 py-2.5"
            >
              <div className="flex items-baseline justify-between">
                <p className="text-[0.8125rem] font-semibold text-[#2d3436]">
                  {d.name}
                </p>
                <span className="font-mono text-[10px] text-[#5a6e32]">
                  {d.n}
                </span>
              </div>
              <p className="mt-0.5 text-[0.6875rem] leading-[1.5] text-[#736a58]">
                {d.examples}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RunCard() {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-[#c4a882]/20 bg-[#fffcf6] p-7 md:col-span-7">
      <StepBadge
        badgeClass="bg-[#c4a882]/25 text-[#5a4d3a]"
        n="03"
        title="Run the protocol"
      />
      <div className="flex-1 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-serif text-[1rem] font-semibold text-[#2d3436]">
              Finnish Sauna Protocol
            </p>
            <p className="mt-0.5 text-[0.75rem] text-[#736a58]">
              Recovery · 28 days · Day 15
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-[#5a6e32]/10 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[#5a6e32]">
            Active
          </span>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
            <span className="font-mono font-medium uppercase tracking-[0.1em] text-[#5a6e32]">
              Baseline · 14d ✓
            </span>
            <span className="font-mono font-medium uppercase tracking-[0.1em] text-[#2d3436]">
              Active · Day 1 of 14
            </span>
            <span className="ml-auto font-mono uppercase tracking-[0.1em] text-[#736a58]">
              Analysis
            </span>
          </div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#2d3436]/10">
            <div className="w-[50%] rounded-full bg-[#5a6e32]" />
            <div className="w-[4%] bg-[#5a6e32]/30" />
          </div>
        </div>

        <div className="rounded-xl bg-[#f5f0e8]/70 px-5 py-4">
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Next step · Today evening
          </span>
          <p className="mt-1.5 text-[0.9375rem] font-semibold text-[#2d3436]">
            Sauna · 15–20 min @ 80–100°C
          </p>
          <p className="mt-1 text-[0.75rem] text-[#736a58]">
            Stay hydrated, electrolytes after · Session 2 of 3
          </p>
        </div>
      </div>
    </div>
  );
}

function LearnCard() {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-[#5a6e32]/20 bg-[#fffcf6] p-7 md:col-span-5">
      <StepBadge
        badgeClass="bg-[#5a6e32]/15 text-[#3d5028]"
        n="04"
        title="See what changed"
      />
      <div className="flex-1 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {METRICS.map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-[#c4a882]/15 bg-[#f5f0e8]/60 px-3 py-3"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
                {m.label}
              </span>
              <p className="mt-1.5 font-serif text-[1.05rem] font-semibold leading-none tracking-tight text-[#2d3436]">
                {m.value}
                {m.unit ? (
                  <span className="ml-0.5 text-[0.6875rem] font-normal text-[#736a58]">
                    {m.unit}
                  </span>
                ) : null}
              </p>
              <p className="mt-1.5 text-[0.6875rem] text-[#5a6e32]">
                {m.change}
              </p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-[#c4a882]/15 bg-[#f5f0e8]/60 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
              HRV trend · 28d
            </span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[0.625rem] text-[#736a58]">
                <span className="inline-block h-px w-2.5 border-t border-dashed border-[#c4a882]" />
                Baseline
              </span>
              <span className="flex items-center gap-1 text-[0.625rem] text-[#736a58]">
                <span className="inline-block h-0.5 w-2.5 rounded-full bg-[#5a6e32]" />
                Active
              </span>
            </div>
          </div>
          <svg
            viewBox="0 0 300 40"
            fill="none"
            className="mt-2 w-full"
            aria-hidden="true"
          >
            <path
              d="M8 28 L35 26 L62 28 L90 25 L118 26 L145 25"
              stroke="#d4c4a8"
              strokeWidth="1.25"
              strokeDasharray="3 2"
              strokeLinecap="round"
            />
            <path
              d="M145 25 L163 22 L181 19 L199 15 L217 16 L235 12 L253 11 L272 8 L290 5"
              stroke="#5a6e32"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
            <circle cx="290" cy="5" r="2.25" fill="#5a6e32" />
          </svg>
        </div>
      </div>
    </div>
  );
}
