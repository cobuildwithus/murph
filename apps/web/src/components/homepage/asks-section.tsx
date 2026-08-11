import { cn } from "@/src/lib/utils";

import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";

type Tint = "sage" | "gold" | "bronze";

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
    bubble: "bg-[#8a5d17]",
    glow: "shadow-[0_30px_80px_-35px_rgba(138,100,40,0.45)]",
  },
  bronze: {
    eyebrow: "text-[#7d4a1a]",
    panel:
      "bg-[linear-gradient(135deg,#ead0b0_0%,#d6ad7e_55%,#bf8a55_100%)]",
    bubble: "bg-[#94591f]",
    glow: "shadow-[0_30px_80px_-35px_rgba(125,74,26,0.45)]",
  },
};

export function WideFeature({
  artifactAlign = "end",
  artifactSide,
  body,
  bubble,
  eyebrow,
  headline,
  tint,
  artifact,
}: {
  // Short artifacts read better vertically centered in the panel; tall ones
  // anchor to the bottom edge.
  artifactAlign?: "center" | "end";
  artifactSide: "left" | "right";
  body: string;
  bubble: string;
  eyebrow: string;
  headline: string;
  tint: Tint;
  artifact: React.ReactNode;
}) {
  const t = TINTS[tint];
  const copy = (
    <div className="flex flex-col justify-center gap-4 px-5 pt-8 pb-1 sm:gap-5 sm:px-10 sm:pt-12 sm:pb-2 lg:col-span-5 lg:py-16 lg:px-12">
      <span
        className={cn(
          "font-mono text-[10px] font-semibold uppercase tracking-[0.2em]",
          t.eyebrow,
        )}
      >
        {eyebrow}
      </span>
      <h3 className="font-serif text-[1.5rem] font-semibold leading-[1.08] tracking-[-0.03em] text-balance text-[#1f1c18] sm:text-[clamp(1.75rem,2.8vw,2.625rem)] sm:leading-[1.02] sm:tracking-[-0.035em]">
        {headline}
      </h3>
      <p className="text-[0.875rem] leading-[1.6] text-pretty text-[#635a48] sm:text-[0.9375rem] sm:leading-[1.65] lg:max-w-[34ch]">
        {body}
      </p>
    </div>
  );

  const panel = (
    <div className="p-2.5 sm:p-4 lg:col-span-7 lg:p-5">
      <div
        className={cn(
          "relative min-h-[330px] overflow-hidden rounded-[1.25rem] sm:min-h-[440px] sm:rounded-[1.5rem] lg:min-h-[480px]",
          t.panel,
          t.glow,
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_-10%,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0)_55%)]" />
        {/* Below lg the bubble sits in flow above the artifact: with the
            fixed-reserve overlay, long bubble copy wraps on narrow screens
            and collides with the artifact card. */}
        <div
          className={cn(
            "relative z-20 flex px-4 pt-5 sm:px-7 sm:pt-8 lg:absolute lg:top-8 lg:px-0 lg:pt-0",
            artifactSide === "left"
              ? "justify-start lg:left-7"
              : "justify-end lg:right-7",
          )}
        >
          <div
            className={cn(
              "max-w-[240px] px-3.5 py-2 text-[0.875rem] leading-[1.4] text-white shadow-[0_8px_24px_-6px_rgba(60,40,20,0.3)] sm:max-w-[280px] sm:px-4 sm:py-2.5 sm:text-[0.9375rem]",
              t.bubble,
              artifactSide === "left"
                ? "rounded-2xl rounded-tl-[6px]"
                : "rounded-2xl rounded-tr-[6px]",
            )}
          >
            {bubble}
          </div>
        </div>
        <div
          className={cn(
            "relative z-10 flex h-full justify-center px-3 pb-4 pt-4 sm:px-8 sm:pb-8 sm:pt-6 lg:pt-32",
            artifactAlign === "center"
              ? "items-center lg:absolute lg:inset-0"
              : "items-end",
          )}
        >
          <div className="w-full max-w-[440px]">{artifact}</div>
        </div>
      </div>
    </div>
  );

  return (
    <article className="overflow-hidden rounded-[1.5rem] bg-[#fffcf6] ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(45,52,54,0.04),0_20px_60px_-30px_rgba(45,52,54,0.12)] sm:rounded-[2rem] lg:grid lg:grid-cols-12 lg:items-stretch">
      {artifactSide === "right" ? copy : panel}
      {artifactSide === "right" ? panel : copy}
    </article>
  );
}

function CompactCard({
  body,
  eyebrow,
  headline,
  artifact,
}: {
  body: string;
  eyebrow: string;
  headline: string;
  artifact: React.ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-5 rounded-[1.5rem] bg-[#fffcf6] p-5 ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(45,52,54,0.04),0_16px_50px_-30px_rgba(45,52,54,0.1)] sm:gap-6 sm:rounded-[1.75rem] sm:p-9">
      <div className="flex flex-col gap-2.5 sm:gap-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#736a58]">
          {eyebrow}
        </span>
        <h3 className="font-serif text-[1.25rem] font-semibold leading-[1.08] tracking-[-0.025em] text-balance text-[#1f1c18] sm:text-[clamp(1.375rem,2vw,1.75rem)] sm:leading-[1.05] sm:tracking-[-0.03em]">
          {headline}
        </h3>
        <p className="text-[0.875rem] leading-[1.55] text-pretty text-[#635a48] sm:leading-[1.6]">
          {body}
        </p>
      </div>
      <div className="mt-auto rounded-2xl bg-[#f5f0e8]/60 p-2.5 ring-1 ring-black/[0.03] sm:rounded-[1.25rem] sm:p-3">
        {artifact}
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#5a6e32] sm:text-[10px] sm:tracking-[0.15em]">
          Tuesday · morning brief
        </span>
        <span className="text-right font-mono text-[9px] tabular-nums text-[#5a6e32] sm:text-[10px]">
          Best HRV in 2 weeks
        </span>
      </div>

      <p className="mt-2.5 font-serif text-[0.9375rem] leading-[1.45] text-[#2d3436] sm:mt-3 sm:text-[1rem]">
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#a04f30] sm:text-[10px] sm:tracking-[0.15em]">
          Latest panel · vs March
        </span>
        <span className="text-right font-mono text-[9px] text-[#736a58] sm:text-[10px]">
          3 flagged
        </span>
      </div>
      <ul className="mt-3 divide-y divide-[#2d3436]/06 sm:mt-4">
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
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
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
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
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
    <div className="rounded-xl bg-[#fffcf6] p-3.5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)] sm:rounded-2xl sm:p-5">
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
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Just you and Murph
          </p>
          <h2 className="mt-4 font-serif text-[1.875rem] font-semibold leading-[1.08] tracking-[-0.03em] text-[#2d3436] sm:text-[clamp(2rem,4vw,3.25rem)]">
            No group? You’re still not doing this alone.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.7] text-[#3a322a]">
            Outside the group chat, Murph is all yours. Experiments, bloodwork,
            habits, bookings, and daily readouts, in a private one on one
            thread.
          </p>
        </div>
        <div className="space-y-5 sm:space-y-6">
          <WideFeature
            tint="gold"
            artifactSide="right"
            eyebrow="Self-experiments"
            headline="I run experiments so you know what actually works for you."
            body="Pick a protocol. Murph baselines you for two weeks, runs the active phase, then texts the before-and-after. No more guessing whether anything moved."
            bubble="Did the magnesium actually work?"
            artifact={<ExperimentArtifact />}
          />

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <CompactCard
              eyebrow="Labs"
              headline="I find insights in your bloodwork over time."
              body="Drop in your latest panel. Murph flags what crept up or down and turns it into the questions worth asking your doctor."
              artifact={<BloodworkArtifact />}
            />
            <CompactCard
              eyebrow="Habits"
              headline="I make it easy to build healthy habits."
              body="A version small enough for bad days, anchored to something you already do. Reminders ease off as it takes hold."
              artifact={<HabitArtifact />}
            />
          </div>

          <WideFeature
            tint="bronze"
            artifactSide="left"
            eyebrow="Closes the loop"
            headline="I order the supplements and book the scans."
            body="Murph finds the DEXA scan nearby, drafts the supplement re-up, and queues the doctor recap on your calendar. You give the final tap. The errands stop slipping."
            bubble="Order me Omega-3, find me a DEXA scan, and confirm my doctor's appointment."
            artifact={<ErrandsArtifact />}
          />

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <CompactCard
              eyebrow="Phone calls"
              headline="I call the dentist and book the appointment."
              body="Dentist, dermatologist, vet, mechanic. Murph dials, waits on hold, picks a slot that fits your week."
              artifact={<CallArtifact />}
            />
            <CompactCard
              eyebrow="Daily readout"
              headline="I read your wearables and tell you what actually matters."
              body="Murph pulls Oura, WHOOP, Garmin, or Apple Health overnight. Wake up to a one-line readout."
              artifact={<RecoveryArtifact />}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
