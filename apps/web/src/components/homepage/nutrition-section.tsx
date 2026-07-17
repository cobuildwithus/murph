import Link from "next/link";

function LabelLookupArtifact() {
  return (
    <div className="rounded-2xl bg-[#fffcf6] p-5 ring-1 ring-black/[0.05] shadow-[0_12px_40px_-12px_rgba(45,52,54,0.18)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-[#3d5028]">
          Label lookup
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[#736a58]">
          UPC match
        </span>
      </div>

      <div className="mt-4">
        <p className="font-serif text-[1.125rem] font-semibold leading-tight text-[#2d3436]">
          Chocolate peanut protein bar
        </p>
        <p className="mt-1 font-mono text-[11px] text-[#5e5530]">
          Per bar · 60 g
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {[
          ["Protein", "20 g"],
          ["Added sugar", "1 g"],
          ["Calories", "210"],
        ].map(([name, amount]) => (
          <div
            key={name}
            className="flex items-baseline justify-between border-b border-[#c4a882]/25 pb-2 text-[0.8125rem] leading-[1.4]"
          >
            <span className="text-[#635a48]">{name}</span>
            <span className="font-mono tabular-nums text-[#2d3436]">
              {amount}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-[#f6e3d3]/80 px-3.5 py-3 ring-1 ring-[#7d4a1a]/10">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#7d4a1a]">
          Product test · PlasticList
        </span>
        <p className="mt-1.5 text-[0.8125rem] leading-[1.55] text-[#635a48]">
          BPA measured at 41 ng/g, near the top of everything PlasticList has
          tested.
        </p>
      </div>

      <div className="mt-3 rounded-xl bg-[#f5f0e8]/70 px-3.5 py-3 ring-1 ring-black/[0.03]">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
          Murph&apos;s read
        </span>
        <p className="mt-1.5 text-[0.8125rem] leading-[1.55] text-[#635a48]">
          The macros are solid, but that BPA number is high for an everyday
          bar. Two bars with clean tests hit the same 20 g. Want the swap?
        </p>
      </div>
    </div>
  );
}

// Styled after the FDA Nutrition Facts panel: heavy header rule, bold rows,
// hairline dividers. The one section artifact that only works for nutrition.
function DatabaseFactsPanel() {
  return (
    <div className="w-full max-w-[400px] rounded-lg bg-white p-6 ring-1 ring-black/[0.08] shadow-[0_30px_80px_-35px_rgba(58,80,40,0.45)]">
      <p className="text-[2rem] font-black leading-none tracking-[-0.01em] text-black">
        Murph Facts
      </p>
      <p className="mt-2 border-b-[10px] border-black pb-3 text-[0.8125rem] leading-[1.4] text-black">
        Behind every answer about what you eat
      </p>

      {[
        ["Food labels", "2,027,814"],
        ["Supplement facts", "239,365"],
        ["Product tests", "20,697"],
      ].map(([name, count]) => (
        <div
          key={name}
          className="flex items-baseline justify-between border-b border-black/20 py-2.5"
        >
          <span className="text-[0.9375rem] font-bold text-black">{name}</span>
          <span className="font-mono text-[0.9375rem] tabular-nums text-black">
            {count}
          </span>
        </div>
      ))}

      <p className="border-b-[4px] border-black py-2.5 text-[0.8125rem] leading-[1.5] text-black">
        Screened against published limits for lead, BPA, and phthalates.
      </p>

      <p className="pt-3 text-[0.75rem] leading-[1.5] text-black/60">
        Counted July 2026. Growing weekly as new labels and lab results come
        in.
      </p>
    </div>
  );
}

export function NutritionSection() {
  return (
    <section className="bg-[linear-gradient(165deg,#ebf0de_0%,#d7e2c3_100%)] px-4 py-20 sm:px-8 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[720px]">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#3d5028]">
            Nutrition
          </p>
          <h2 className="mt-4 font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#26311f]">
            Murph reads the label so you don&apos;t have to.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[1rem] leading-[1.7] text-[#3f4a34]">
            Murph carries the nutrition facts for over 2 million foods and
            239,000 supplements. Ask about anything on your shelf and it
            answers from the actual label, checks it against independent lab
            tests, and flags what the front of the pack leaves out.
          </p>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-10">
          <div className="w-full max-w-[400px] lg:mx-auto">
            <div className="flex justify-end">
              <div className="max-w-[300px] rounded-2xl rounded-tr-[6px] bg-[#2c7a3f] px-4 py-2.5 text-[0.9375rem] leading-[1.4] text-white shadow-[0_8px_24px_-6px_rgba(60,40,20,0.3)]">
                are these protein bars actually healthy?
              </div>
            </div>
            <div className="mt-5">
              <LabelLookupArtifact />
            </div>
          </div>

          <div className="flex w-full max-w-[400px] flex-col gap-8 lg:mx-auto">
            <DatabaseFactsPanel />
            <p className="text-[0.9375rem] leading-[1.55]">
              <Link
                className="font-medium text-[#26311f] underline decoration-[#3d5028]/40 decoration-2 underline-offset-4 transition-colors hover:decoration-[#26311f]"
                href="/search"
              >
                Search the whole database yourself
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
