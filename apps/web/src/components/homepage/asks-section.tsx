import { VoiceMemoPlayer } from "./voice-memo-player";

type Tint = "sage" | "gold" | "peach" | "bronze" | "mauve" | "khaki";

const TINTS: Record<
  Tint,
  {
    eyebrow: string;
    panel: string;
    bubble: string;
    glow: string;
  }
> = {
  sage: {
    eyebrow: "text-[#3d5028]",
    panel:
      "bg-[linear-gradient(135deg,#e8efde_0%,#d5e2c4_55%,#c8d7b1_100%)]",
    bubble: "bg-[#2c7a3f]",
    glow: "shadow-[0_30px_80px_-35px_rgba(58,80,40,0.45)]",
  },
  gold: {
    eyebrow: "text-[#8a6428]",
    panel:
      "bg-[linear-gradient(135deg,#f3e8d0_0%,#ead7af_55%,#dec390_100%)]",
    bubble: "bg-[#b27a1e]",
    glow: "shadow-[0_30px_80px_-35px_rgba(138,100,40,0.45)]",
  },
  peach: {
    eyebrow: "text-[#a04f30]",
    panel:
      "bg-[linear-gradient(135deg,#f7ddca_0%,#eec4a8_55%,#e3ad8a_100%)]",
    bubble: "bg-[#c25a32]",
    glow: "shadow-[0_30px_80px_-35px_rgba(160,79,48,0.45)]",
  },
  bronze: {
    eyebrow: "text-[#7d4a1a]",
    panel:
      "bg-[linear-gradient(135deg,#ead0b0_0%,#d6ad7e_55%,#bf8a55_100%)]",
    bubble: "bg-[#94591f]",
    glow: "shadow-[0_30px_80px_-35px_rgba(125,74,26,0.45)]",
  },
  mauve: {
    eyebrow: "text-[#7d4858]",
    panel:
      "bg-[linear-gradient(135deg,#eedce0_0%,#dbb8c0_55%,#c79da6_100%)]",
    bubble: "bg-[#a05368]",
    glow: "shadow-[0_30px_80px_-35px_rgba(125,72,88,0.45)]",
  },
  khaki: {
    eyebrow: "text-[#5e5530]",
    panel:
      "bg-[linear-gradient(135deg,#e8e5d0_0%,#d0c9a8_55%,#b6ad85_100%)]",
    bubble: "bg-[#7a6e3a]",
    glow: "shadow-[0_30px_80px_-35px_rgba(94,85,48,0.45)]",
  },
};

function FeatureCard({
  artifact,
  body,
  bubble,
  eyebrow,
  headline,
  tint,
}: {
  artifact: React.ReactNode;
  body: string;
  bubble: string;
  eyebrow: string;
  headline: string;
  tint: Tint;
}) {
  const t = TINTS[tint];
  return (
    <article className="overflow-hidden rounded-[2rem] bg-[#fffcf6] ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(45,52,54,0.04),0_20px_60px_-30px_rgba(45,52,54,0.12)] lg:grid lg:grid-cols-12 lg:items-stretch">
      <div className="flex flex-col justify-center gap-5 px-7 pt-10 pb-2 sm:px-10 sm:pt-12 lg:col-span-5 lg:px-12 lg:py-16 lg:pr-0">
        <span
          className={`font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${t.eyebrow}`}
        >
          {eyebrow}
        </span>
        <h3 className="font-serif text-[clamp(1.625rem,2.6vw,2.375rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-balance text-[#1f1c18]">
          {headline}
        </h3>
        <p className="text-[0.9375rem] leading-[1.65] text-pretty text-[#635a48] lg:max-w-[34ch]">
          {body}
        </p>
      </div>

      <div className="p-3 sm:p-4 lg:col-span-7 lg:p-5">
        <div
          className={`relative overflow-hidden rounded-[1.5rem] ${t.panel} ${t.glow} min-h-[340px] sm:min-h-[400px] lg:min-h-[440px]`}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_-10%,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0)_55%)]" />

          <div className="absolute right-5 top-6 z-20 sm:right-7 sm:top-8">
            <div
              className={`max-w-[260px] rounded-2xl rounded-tr-[6px] px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.25)] ${t.bubble}`}
            >
              {bubble}
            </div>
          </div>

          <div className="relative z-10 flex h-full items-end justify-center px-5 pb-5 pt-24 sm:px-8 sm:pb-8 sm:pt-28 lg:pt-32">
            <div className="w-full max-w-[420px]">{artifact}</div>
          </div>
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
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#5a6e32]">
          Tuesday · morning brief
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[#5a6e32]">
          Best HRV in 2 weeks
        </span>
      </div>

      <p className="mt-3 font-serif text-[1rem] leading-[1.45] text-[#2d3436]">
        Recovery is solid. The sauna nights are finally showing up, so you
        can hit the hard session today.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-[#f5f0e8]/70 px-3 py-3 ring-1 ring-black/[0.03]"
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
              {s.label}
            </span>
            <p className="mt-1.5 font-serif text-[1.05rem] font-semibold leading-none tracking-tight tabular-nums text-[#2d3436]">
              {s.value}
              {s.unit ? (
                <span className="ml-0.5 text-[0.6875rem] font-normal text-[#736a58]">
                  {s.unit}
                </span>
              ) : null}
            </p>
            <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[#5a6e32]">
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
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-serif text-[1.0625rem] font-semibold leading-tight text-[#2d3436]">
            Magnesium for Sleep
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
            Day 9 of 14 · Active phase
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[#5a6e32]/12 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#3d5028]">
          On track
        </span>
      </div>

      <div className="mt-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-[#2d3436]/8">
          <div className="w-[50%] rounded-full bg-[#5a6e32]" />
          <div className="ml-px w-[14%] bg-[#5a6e32]/40" />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58] tabular-nums">
          <span>Baseline · 7d</span>
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
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#a04f30]">
          Latest panel · vs March
        </span>
        <span className="font-mono text-[10px] text-[#736a58]">3 flagged</span>
      </div>
      <ul className="mt-4 divide-y divide-[#2d3436]/06">
        {markers.map((m) => (
          <li
            key={m.label}
            className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="min-w-[80px] font-serif text-[0.9375rem] font-semibold text-[#2d3436]">
              {m.label}
            </span>
            <span className="flex items-baseline gap-1 font-mono text-[11px] tabular-nums text-[#736a58]">
              <span>{m.from}</span>
              <span aria-hidden="true">→</span>
              <span className="text-[#2d3436]">{m.to}</span>
              <span className="text-[10px]">{m.unit}</span>
            </span>
            <span
              className={`ml-auto rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums ${
                m.tone === "good"
                  ? "bg-[#5a6e32]/12 text-[#3d5028]"
                  : "bg-[#a04f30]/12 text-[#a04f30]"
              }`}
            >
              {m.delta} {m.unit}
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
      eyebrow: "Booked",
      title: "DEXA scan at BodySpec",
      meta: "Thu 2:00 PM, 1.4 mi away · $49",
    },
    {
      eyebrow: "In your cart",
      title: "Re-up Omega-3",
      meta: "Thorne EPA/DHA, 90ct · ships in 2 days",
    },
    {
      eyebrow: "Queued",
      title: "Dr. Patel recap on calendar",
      meta: "With 3 questions to ask · 30 min hold",
    },
  ];
  return (
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#7d4a1a]">
          Things I lined up for you
        </span>
        <span className="font-mono text-[10px] text-[#736a58]">3 ready</span>
      </div>
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-xl bg-[#f5f0e8]/70 px-3.5 py-3 ring-1 ring-black/[0.03]"
          >
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#7d4a1a]">
              {item.eyebrow}
            </span>
            <p className="mt-0.5 font-serif text-[0.9375rem] font-semibold leading-tight text-[#2d3436]">
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
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#7d4858]">
          Appointment booked
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[#736a58]">
          just now
        </span>
      </div>

      <div className="mt-4">
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
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
          Call summary
        </span>
        <p className="mt-1.5 text-[0.8125rem] leading-[1.55] text-[#635a48]">
          4 min on the line. Navigated the menu, held for the receptionist,
          picked a slot that fits your week.
        </p>
      </div>
    </div>
  );
}

function HabitArtifact() {
  return (
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#5e5530]">
          Habit · day 24
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[#736a58]">
          18 of 24 days
        </span>
      </div>

      <div className="mt-4">
        <p className="font-serif text-[1.125rem] font-semibold leading-tight text-[#2d3436]">
          Daily morning run
        </p>
        <p className="mt-1 font-mono text-[11px] tabular-nums text-[#5e5530]">
          Right after coffee, before email
        </p>
      </div>

      <div className="mt-4">
        <VoiceMemoPlayer
          src="/audio/one-foot-two-foot.mp3"
          caption="Murph sent a hype track. Press play."
        />
      </div>

      <p className="mt-4 text-[0.75rem] leading-[1.5] text-[#736a58]">
        Sticking. Reminders backed off from daily to weekly check-in.
      </p>
    </div>
  );
}

export function AsksGridSection() {
  return (
    <section className="bg-[#f5f0e8] px-4 py-20 sm:px-8 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[1200px]">
        <div className="space-y-5 sm:space-y-6">
          <FeatureCard
            tint="gold"
            eyebrow="Self-experiments"
            headline="I run experiments so you know what actually works for you."
            body="Pick a protocol. Murph baselines you for a week, runs the active phase, then texts the before-and-after. No more guessing whether anything moved."
            bubble="Did the magnesium actually work?"
            artifact={<ExperimentArtifact />}
          />
          <FeatureCard
            tint="bronze"
            eyebrow="Closes the loop"
            headline="I order the supplements and book the scans."
            body="Murph finds the DEXA scan nearby, drafts the supplement re-up, and queues the doctor recap on your calendar. You give the final tap. The errands stop slipping."
            bubble="Order me Omega-3, find me a DEXA scan, and confirm my doctor's appointment."
            artifact={<ErrandsArtifact />}
          />
          <FeatureCard
            tint="peach"
            eyebrow="Labs"
            headline="I find insights in your bloodwork over time."
            body="Drop in your latest panel. Murph compares it marker by marker, flags what crept up or down, and turns it into the questions worth asking your doctor."
            bubble="Did my LDL get worse?"
            artifact={<BloodworkArtifact />}
          />
          <FeatureCard
            tint="mauve"
            eyebrow="Phone calls"
            headline="I call the dentist and book the appointment."
            body="Dentist, dermatologist, vet, hair, mechanic. Murph dials the number, waits on hold, picks a slot that fits your week, and sends you the confirmation."
            bubble="Call my dentist and book a cleaning."
            artifact={<CallArtifact />}
          />
          <FeatureCard
            tint="khaki"
            eyebrow="Habits"
            headline="I make it easy to build healthy habits."
            body="Murph picks a version small enough for bad days, anchors it to something you already do, and eases off the reminders as it takes hold. No streaks, no shame, no spam."
            bubble="Help me actually run every morning."
            artifact={<HabitArtifact />}
          />
          <FeatureCard
            tint="sage"
            eyebrow="Daily readout"
            headline="I read your wearables and tell you what actually matters."
            body="Murph pulls Oura, WHOOP, Garmin, or Apple Health overnight. Wake up to a one-line readout instead of three apps competing for your attention."
            bubble="How'd I recover?"
            artifact={<RecoveryArtifact />}
          />
        </div>
      </div>
    </section>
  );
}
