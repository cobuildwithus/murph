import { cn } from "@/src/lib/utils";

import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";

type Tint = "sage" | "gold" | "bronze";

const TINTS: Record<Tint, { panel: string; bubble: string }> = {
  sage: {
    panel: "bg-[linear-gradient(135deg,#e8efde_0%,#d5e2c4_55%,#c8d7b1_100%)]",
    bubble: "bg-[#2c7a3f]",
  },
  gold: {
    panel: "bg-[linear-gradient(135deg,#f3e8d0_0%,#ead7af_55%,#dec390_100%)]",
    bubble: "bg-[#8a5d17]",
  },
  bronze: {
    panel: "bg-[linear-gradient(135deg,#ead0b0_0%,#d6ad7e_55%,#bf8a55_100%)]",
    bubble: "bg-[#94591f]",
  },
};

export function FeatureCard({
  bubble,
  headline,
  tint,
  artifact,
}: {
  bubble?: string;
  headline: string;
  tint?: Tint;
  artifact: React.ReactNode;
}) {
  const colors = tint ? TINTS[tint] : null;

  return (
    <article className="grid min-w-0 grid-rows-[auto_1fr] gap-5 lg:row-span-2 lg:grid-rows-subgrid">
      <h3 className="max-w-[30ch] font-serif text-2xl font-semibold leading-[1.12] tracking-[-0.025em] text-balance text-[#2d3436] sm:text-[1.75rem]">
        {headline}
      </h3>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-6 overflow-hidden rounded-3xl p-5 sm:gap-8 sm:p-8",
          colors?.panel ?? "bg-[#ece6da]",
        )}
      >
        {bubble ? (
          <div
            className={cn(
              "max-w-[280px] self-end rounded-2xl rounded-tr-md px-4 py-2.5 text-[0.875rem] leading-[1.4] text-white sm:text-[0.9375rem]",
              colors?.bubble ?? "bg-[#5a6e32]",
            )}
          >
            {bubble}
          </div>
        ) : null}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full min-w-0 max-w-[440px]">{artifact}</div>
        </div>
      </div>
    </article>
  );
}

function RecoveryArtifact() {
  const stats = [
    { label: "HRV", value: "52.1", unit: "ms", delta: "+12%" },
    { label: "Deep sleep", value: "1h 42m", delta: "+18%" },
    { label: "Resting HR", value: "58", unit: "bpm", delta: "-4%" },
  ];
  return (
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
      <p className="font-serif text-[0.9375rem] leading-[1.45] text-[#2d3436] sm:text-[1rem]">
        Recovery is above your recent baseline, and HRV was highest on the
        sauna nights. Today looks like a strong training day.
      </p>

      <div className="mt-3 divide-y divide-[#2d3436]/[0.06] rounded-xl bg-[#f5f0e8]/70 px-3.5 ring-1 ring-black/[0.03] min-[400px]:grid min-[400px]:grid-cols-3 min-[400px]:gap-2 min-[400px]:divide-y-0 min-[400px]:bg-transparent min-[400px]:px-0 min-[400px]:ring-0 sm:mt-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-1.5 py-2.5 min-[400px]:block min-[400px]:rounded-xl min-[400px]:bg-[#f5f0e8]/70 min-[400px]:px-3 min-[400px]:py-3 min-[400px]:ring-1 min-[400px]:ring-black/[0.03]"
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
              {s.label}
            </span>
            <p className="font-serif text-[1rem] font-semibold leading-none tracking-tight tabular-nums text-[#2d3436] min-[400px]:mt-1.5 min-[400px]:text-[1.05rem]">
              {s.value}
              {s.unit ? (
                <span className="ml-0.5 text-[0.6875rem] font-normal text-[#736a58]">
                  {s.unit}
                </span>
              ) : null}
            </p>
            <p className="font-mono text-[9px] tabular-nums text-[#5a6e32] min-[400px]:mt-1.5 min-[400px]:text-[10px]">
              {s.delta}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentArtifact() {
  return (
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
      <p className="font-serif text-[1.0625rem] font-semibold leading-tight text-[#2d3436]">
        Magnesium for Sleep
      </p>

      <div className="mt-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-[#2d3436]/8">
          <div className="w-[50%] rounded-full bg-[#5a6e32]" />
          <div className="ml-px w-[32%] bg-[#5a6e32]/40" />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58] tabular-nums">
          <span>Baseline · 14d</span>
          <span>Active · 9/14</span>
          <span>Readout</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-[#f5f0e8]/70 px-3.5 py-3 ring-1 ring-black/[0.03]">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
            Deep sleep
          </span>
          <p className="mt-1.5 font-serif text-[1.125rem] font-semibold leading-none tracking-tight tabular-nums text-[#2d3436]">
            1h 42m
          </p>
          <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[#5a6e32]">
            +18% vs baseline
          </p>
        </div>
        <div className="rounded-xl bg-[#f5f0e8]/70 px-3.5 py-3 ring-1 ring-black/[0.03]">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
            REM
          </span>
          <p className="mt-1.5 font-serif text-[1.125rem] font-semibold leading-none tracking-tight tabular-nums text-[#2d3436]">
            1h 08m
          </p>
          <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[#5a6e32]">
            +6% vs baseline
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-[#f5f0e8]/70 px-4 py-3 ring-1 ring-black/[0.03]">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
          Deep sleep · baseline vs active
        </span>
        <svg
          viewBox="0 0 300 40"
          fill="none"
          className="mt-2 w-full"
          aria-hidden="true"
        >
          <path
            d="M6 28 L34 26 L62 28 L90 25 L118 27"
            stroke="#c4a882"
            strokeWidth="1.25"
            strokeDasharray="3 2"
            strokeLinecap="round"
          />
          <path
            d="M122 26 L150 22 L178 18 L206 14 L234 12 L262 9 L290 6"
            stroke="#5a6e32"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <circle cx="290" cy="6" r="2.5" fill="#5a6e32" />
        </svg>
      </div>
    </div>
  );
}

function BloodworkArtifact() {
  const markers = [
    {
      label: "LDL",
      from: "108",
      to: "122",
      unit: "mg/dL",
      delta: "+14",
      tone: "warn" as const,
    },
    {
      label: "Ferritin",
      from: "42",
      to: "31",
      unit: "ng/mL",
      delta: "-11",
      tone: "warn" as const,
    },
    {
      label: "Vitamin D",
      from: "28",
      to: "44",
      unit: "ng/mL",
      delta: "+16",
      tone: "good" as const,
    },
    {
      label: "HbA1c",
      from: "5.4",
      to: "5.3",
      unit: "%",
      delta: "-0.1",
      tone: "good" as const,
    },
  ];
  return (
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
      <ul className="divide-y divide-[#2d3436]/06">
        {markers.map((m) => (
          <li
            key={m.label}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 first:pt-0 last:pb-0 min-[420px]:flex min-[420px]:gap-3"
          >
            <span className="font-serif text-[0.9375rem] font-semibold text-[#2d3436] min-[420px]:min-w-[80px]">
              {m.label}
            </span>
            <span className="col-span-2 row-start-2 mt-0.5 flex items-baseline gap-1 font-mono text-[10px] tabular-nums text-[#736a58] min-[420px]:col-span-1 min-[420px]:mt-0 min-[420px]:text-[11px]">
              <span>{m.from}</span>
              <span aria-hidden="true">→</span>
              <span className="text-[#2d3436]">{m.to}</span>
              <span className="text-[10px]">{m.unit}</span>
            </span>
            <span
              className={`col-start-2 row-start-1 justify-self-end rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums min-[420px]:ml-auto ${
                m.tone === "good"
                  ? "bg-[#5a6e32]/12 text-[#3d5028]"
                  : "bg-[#a04f30]/12 text-[#a04f30]"
              }`}
            >
              {m.delta}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 rounded-xl bg-[#f5f0e8]/70 px-3.5 py-2.5 text-[0.8125rem] leading-[1.5] text-[#635a48] ring-1 ring-black/[0.03]">
        LDL climbed since you switched diets in April. Worth asking your
        clinician about the trend before the next panel.
      </p>
    </div>
  );
}

function ErrandsArtifact() {
  const items = [
    {
      title: "DEXA scan at BodySpec",
      meta: "Thu 2:00 PM, 1.4 mi away · $49",
    },
    {
      title: "Re-up Omega-3",
      meta: "Thorne EPA/DHA, 90ct · ships in 2 days",
    },
    {
      title: "Dr. Patel recap on calendar",
      meta: "With 3 questions to ask · 30 min hold",
    },
  ];
  return (
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-xl bg-[#f5f0e8]/70 px-3.5 py-3 ring-1 ring-black/[0.03]"
          >
            <p className="font-serif text-[0.9375rem] font-semibold leading-tight text-[#2d3436]">
              {item.title}
            </p>
            <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[#736a58]">
              {item.meta}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CallArtifact() {
  return (
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
      <div>
        <p className="font-serif text-[1.125rem] font-semibold leading-tight text-[#2d3436]">
          Cleaning + exam
        </p>
        <p className="mt-1 text-[0.9375rem] leading-[1.5] text-[#635a48]">
          Dr. Singh, Bridge Dental
        </p>
        <p className="mt-2 font-mono text-[11px] tabular-nums text-[#7d4858]">
          Thursday, June 4 · 10:15 AM
        </p>
      </div>

      <div className="mt-4 rounded-xl bg-[#f5f0e8]/70 px-3.5 py-3 ring-1 ring-black/[0.03]">
        <p className="text-[0.8125rem] leading-[1.55] text-[#635a48]">
          4 min on the line. Navigated the menu, held for the receptionist,
          picked a slot that fits your week.
        </p>
      </div>
    </div>
  );
}

function HabitArtifact() {
  return (
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
      <div>
        <p className="font-serif text-[1.125rem] font-semibold leading-tight text-[#2d3436]">
          Daily morning run
        </p>
        <p className="mt-1 font-mono text-[11px] tabular-nums text-[#5e5530]">
          Right after coffee, before email
        </p>
      </div>

      <div className="mt-4">
        <VoiceMemoPlayer
          bars={32}
          src="/audio/one-foot-two-foot.mp3"
          caption="Murph sent a hype track. Press play."
        />
      </div>
    </div>
  );
}

export function AsksGridSection() {
  return (
    <section className="bg-[#f5f0e8] px-4 pt-10 pb-20 sm:px-8 sm:pt-20 sm:pb-20 lg:px-16 lg:pt-28 lg:pb-28">
      <div className="mx-auto max-w-[1200px]">
        {/* Bridges the group-chat story above back to the 1:1 assistant:
            everything below happens in a private thread with Murph. */}
        <div className="mb-10 max-w-[720px] sm:mb-12">
          <h2 className="font-serif text-[1.875rem] font-semibold leading-[1.08] tracking-[-0.03em] text-[#2d3436] sm:text-[clamp(2rem,4vw,3.25rem)]">
            No group? You’re still not doing this alone.
          </h2>
        </div>
        <div className="grid gap-x-10 gap-y-8 sm:gap-y-10 lg:grid-cols-2">
          <FeatureCard
            tint="gold"
            headline="I run experiments so you know what actually works for you."
            bubble="Did the magnesium actually work?"
            artifact={<ExperimentArtifact />}
          />

          <FeatureCard
            headline="I find insights in your bloodwork over time."
            artifact={<BloodworkArtifact />}
          />
          <FeatureCard
            headline="I make it easy to build healthy habits."
            artifact={<HabitArtifact />}
          />

          <FeatureCard
            tint="bronze"
            headline="I order the supplements and book the scans."
            bubble="Order me Omega-3, find me a DEXA scan, and confirm my doctor's appointment."
            artifact={<ErrandsArtifact />}
          />

          <FeatureCard
            headline="I call the dentist and book the appointment."
            artifact={<CallArtifact />}
          />
          <FeatureCard
            headline="I read your wearables and tell you what actually matters."
            artifact={<RecoveryArtifact />}
          />
        </div>
      </div>
    </section>
  );
}
