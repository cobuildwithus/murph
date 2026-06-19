const PILLARS = [
  {
    body: "Protocols cite 5,972 studies",
    title: "Research-backed",
  },
  {
    body: "Apache 2.0 — inspect or self-host",
    title: "Open source",
  },
  {
    body: "Encrypted, never sold",
    title: "Private by default",
  },
  {
    body: "Export data or cancel anytime",
    title: "Yours to keep",
  },
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

        <div className="mt-8 grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="flex flex-col gap-3 rounded-2xl border border-[#c4a882]/15 bg-[#fffcf6] px-6 py-5"
            >
              <span
                aria-hidden="true"
                className="inline-block size-1.5 rounded-full bg-[#5a6e32]"
              />
              <h3 className="font-serif text-[1.375rem] font-semibold leading-[1.15] tracking-[-0.02em] text-[#2d3436]">
                {p.title}
              </h3>
              <p className="text-[0.75rem] leading-[1.5] text-[#736a58]">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
