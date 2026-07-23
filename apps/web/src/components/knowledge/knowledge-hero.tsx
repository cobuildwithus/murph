import Image from "next/image";

const POINTS = [
  {
    label: "Built on studies",
    body: "Each skill starts with the research, not a stray article. We read it, then build the skill from it.",
  },
  {
    label: "Evidence is graded",
    body: "Not every study holds up. Murph leans on the strong ones and flags when the evidence is thin.",
  },
  {
    label: "Kept up to date",
    body: "When new research comes out, the skill is updated. It is not stuck on what an AI read years ago.",
  },
  {
    label: "Open source",
    body: "Each skill is a public playbook. Read exactly what Murph knows, and the studies behind it.",
  },
] as const;

export function KnowledgeHero() {
  return (
    <section className="bg-[#f5f0e8] px-5 pb-16 pt-28 sm:px-10 lg:px-16 lg:pb-24 lg:pt-36">
      <div className="mx-auto max-w-[1080px]">
        <div className="grid items-center gap-x-14 gap-y-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#5a6e32]">
              Knowledge
            </span>
            <h1 className="mt-6 max-w-[15ch] font-serif text-[clamp(2.25rem,5vw,3.75rem)] font-semibold leading-[1.03] tracking-[-0.03em] text-[#2d3436]">
              Ask a chatbot, or ask a specialist.
            </h1>
            <p className="mt-7 max-w-[52ch] text-[1.0625rem] leading-[1.7] text-pretty text-[#635a48] sm:text-[1.125rem]">
              A general chatbot answers from whatever it read online, then starts
              over next time. Murph is built for health: grounded in current
              research, it reads your own data, remembers your history, and acts
              on it, across sleep, food, training, sauna, and recovery.
            </p>
          </div>

          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-[#c4a882]/20 sm:max-w-[440px] lg:justify-self-end">
            <Image
              alt="An open notebook with a hand-drawn chart beside supplements, rosemary, and a glass of water in morning light."
              className="object-cover"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 440px"
              src="/design-assets/knowledge-notebook.jpg"
            />
          </div>
        </div>

        <div className="mt-14 grid gap-x-8 gap-y-8 border-t border-[#c4a882]/30 pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {POINTS.map((p, i) => (
            <div
              key={p.label}
              className={
                i > 0 ? "lg:border-l lg:border-[#c4a882]/30 lg:pl-8" : ""
              }
            >
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#5a6e32]">
                {p.label}
              </span>
              <p className="mt-3 max-w-[34ch] text-[0.9375rem] leading-[1.6] text-[#736a58]">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
