const PILLARS = [
  {
    anchor: "5,972",
    label: "Studies cited",
    body: "Every protocol traces to peer-reviewed evidence.",
  },
  {
    anchor: "Apache 2.0",
    label: "License",
    body: "Inspect, fork, or run the whole stack yourself.",
  },
  {
    anchor: "Never sold",
    label: "Privacy",
    body: "Encrypted at rest. Never used to train AI.",
  },
  {
    anchor: "Anytime",
    label: "Export",
    body: "Take everything with you on the way out.",
  },
] as const;

const COL_BORDER_CLASS = [
  "",
  "sm:border-l sm:border-[#c4a882]/40 sm:pl-8 lg:pl-10",
  "lg:border-l lg:border-[#c4a882]/40 lg:pl-10",
  "sm:border-l sm:border-[#c4a882]/40 sm:pl-8 lg:pl-10",
] as const;

export function TrustSection() {
  return (
    <section className="bg-[#f5f0e8] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1080px]">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-block h-px w-10 bg-[#2d3436]/40"
          />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#2d3436]">
            Why people trust Murph
          </span>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-y-10 sm:grid-cols-2 sm:gap-y-12 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <div
              key={p.label}
              className={`flex flex-col gap-3 ${COL_BORDER_CLASS[i]}`}
            >
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#736a58]">
                {p.label}
              </span>
              <p className="font-serif text-[clamp(1.75rem,2.6vw,2.25rem)] font-semibold leading-[1] tracking-[-0.02em] text-[#2d3436]">
                {p.anchor}
              </p>
              <p className="max-w-[26ch] text-[0.875rem] leading-[1.55] text-[#736a58]">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
