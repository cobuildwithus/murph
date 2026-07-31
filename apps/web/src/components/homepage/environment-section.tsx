import Image from "next/image";
import Link from "next/link";

const CATEGORY_ROWS = [
  {
    grade: "C",
    icon: "/design-assets/habitat/bed.svg",
    name: "Sleep",
    tone: "amber",
  },
  {
    grade: "B",
    icon: "/design-assets/habitat/purifier.svg",
    name: "Air & water",
    tone: "olive",
  },
  {
    grade: "A",
    icon: "/design-assets/habitat/lamp.svg",
    name: "Light",
    tone: "olive",
  },
  {
    grade: "–",
    icon: "/design-assets/habitat/plunge.svg",
    name: "Recovery & devices",
    tone: "muted",
  },
  {
    grade: "C",
    icon: "/design-assets/habitat/desk.svg",
    name: "Workspace",
    tone: "amber",
  },
] as const;

const GRADE_CHIP_TONES: Record<string, string> = {
  amber: "bg-[#d89a1c]/15 text-[#8a5a00]",
  olive: "bg-[#5a6e32]/15 text-[#3d5028]",
  muted: "bg-[#736a58]/10 text-[#736a58]",
};

function ReportCardArtifact() {
  return (
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#3d5028]">
          Environment grade
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[#736a58]">
          42 of 48 known
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-xl bg-[#d89a1c]/15 font-serif text-3xl font-semibold text-[#8a5a00]">
          C
        </span>
        <div>
          <p className="font-serif text-[1.75rem] font-semibold leading-none tracking-[-0.02em] text-[#2d3436]">
            74%
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#736a58]">
            Getting there
          </p>
        </div>
      </div>

      <div className="mt-4">
        {CATEGORY_ROWS.map((row) => (
          <div
            key={row.name}
            className="flex items-center gap-3 border-b border-[#c4a882]/25 py-2 last:border-b-0"
          >
            <Image
              src={row.icon}
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0 object-contain"
            />
            <span className="flex-1 text-[0.8125rem] font-medium text-[#2d3436]">
              {row.name}
            </span>
            <span
              className={`flex size-6 items-center justify-center rounded-md font-serif text-xs font-semibold ${GRADE_CHIP_TONES[row.tone]}`}
            >
              {row.grade}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CheckNextArtifact() {
  return (
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#3d5028]">
        What to check next
      </span>

      <div className="mt-3 space-y-2.5">
        <div className="rounded-xl bg-[#a04f30]/10 px-3.5 py-3 ring-1 ring-[#a04f30]/35">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[0.875rem] font-medium text-[#5c3320]">
              Typical night CO₂
            </span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a04f30]">
              1150 ppm
            </span>
          </div>
          <p className="mt-1 text-[0.8125rem] leading-[1.5] text-[#5c3320]">
            Above the 1000 ppm target. A 2 cm window gap usually fixes it.
          </p>
        </div>

        {[
          ["Screen setup", "laptop only — your neck loses all day"],
          ["Mattress age", "not known yet — one question fills it in"],
        ].map(([name, note]) => (
          <div
            key={name}
            className="rounded-xl px-3.5 py-3 ring-1 ring-[#c4a882]/30"
          >
            <p className="text-[0.875rem] font-medium text-[#2d3436]">{name}</p>
            <p className="mt-0.5 text-[0.8125rem] leading-[1.5] text-[#635a48]">
              {note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EnvironmentSection() {
  return (
    <section className="bg-[linear-gradient(165deg,#f2ead9_0%,#e9ddc2_100%)] px-4 py-20 sm:px-8 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[720px]">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#3d5028]">
            Environment
          </p>
          <h2 className="mt-4 font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#26311f]">
            Health is built at home. Murph grades yours.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.7] text-[#3f4a34]">
            Murph maps the place you live and work: bedroom CO₂ at night,
            light after sunset, what your desk does to your neck. Every fact
            is checked against a healthy target and graded like a report
            card, and each one opens into advice worth reading.
          </p>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:items-start lg:gap-10">
          <div className="w-full max-w-[400px] lg:mx-auto">
            <div className="flex justify-end">
              <div className="max-w-[300px] rounded-2xl rounded-tr-[6px] bg-[#2c7a3f] px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-white shadow-[0_8px_24px_-6px_rgba(60,40,20,0.3)]">
                why do I wake up tired after 8 hours?
              </div>
            </div>
            <div className="mt-5">
              <ReportCardArtifact />
            </div>
          </div>

          <div className="flex w-full max-w-[400px] flex-col gap-8 lg:mx-auto">
            <CheckNextArtifact />
            <p className="text-[0.9375rem] leading-[1.55]">
              <Link
                className="font-medium text-[#26311f] underline decoration-[#3d5028]/40 decoration-2 underline-offset-4 transition-colors hover:decoration-[#26311f]"
                href="/environment"
              >
                See a full environment report
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
