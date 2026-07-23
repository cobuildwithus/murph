const ROWS = [
  {
    dimension: "Built for health",
    generic: "Health is one topic among the millions it was trained on.",
    murph: "Built only for health, on current research graded for quality.",
  },
  {
    dimension: "Keeping current",
    generic: "Knows what it was trained on, whenever that was.",
    murph: "Its skills update as new research comes out.",
  },
  {
    dimension: "Knowing you",
    generic: "Starts fresh unless you paste your history in every time.",
    murph: "Reads the data you connect and remembers what you tell it.",
  },
  {
    dimension: "How specific it gets",
    generic: "General advice you still have to adapt to yourself.",
    murph: "A plan shaped to your body, your gear, and your goal.",
  },
  {
    dimension: "Following through",
    generic: "Answers, then the conversation ends.",
    murph: "Helps you act, then checks back in when you want.",
  },
  {
    dimension: "Checking its work",
    generic: "No trail from the answer back to a source.",
    murph: "Open skills you can read, with every source shown.",
  },
] as const;

function CrossGlyph() {
  return (
    <span
      aria-hidden="true"
      className="mt-[0.35rem] inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-[#877759]/55 text-[0.65rem] leading-none text-[#877759]"
    >
      ×
    </span>
  );
}

function CheckGlyph() {
  return (
    <span
      aria-hidden="true"
      className="mt-[0.35rem] inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[#5a6e32] text-[0.6rem] leading-none text-[#f5f0e8]"
    >
      ✓
    </span>
  );
}

export function ComparisonSection() {
  return (
    <section className="bg-[#ebdfc6] px-5 py-16 sm:px-10 lg:px-16 lg:py-24">
      <div className="mx-auto max-w-[1080px]">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#3a4a1e]">
          Murph vs a general chatbot
        </span>
        <h2 className="mt-5 max-w-[18ch] font-serif text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-[#2d3436]">
          Same question. A different kind of answer.
        </h2>

        {/* Column headers */}
        <div className="mt-12 grid grid-cols-1 gap-x-6 md:grid-cols-[1fr_1fr_1.15fr]">
          <div className="hidden md:block" />
          <div className="hidden px-1 md:block">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#635a48]">
              A general chatbot
            </span>
          </div>
          <div className="hidden rounded-t-2xl border border-b-0 border-[#7a8c6e]/25 bg-[#fffcf6] px-6 pt-5 md:block">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#5a6e32]">
              Murph
            </span>
          </div>
        </div>

        <div className="md:grid md:grid-cols-[1fr_1fr_1.15fr] md:gap-x-6">
          {ROWS.map((row, i) => (
            <div key={row.dimension} className="contents">
              {/* Dimension */}
              <div
                className={`pt-8 md:border-t md:border-[#c4a882]/25 md:pt-5 ${
                  i === 0 ? "md:border-t-0" : ""
                }`}
              >
                <p className="font-serif text-[1.0625rem] font-semibold leading-[1.3] text-[#2d3436]">
                  {row.dimension}
                </p>
              </div>

              {/* Generic */}
              <div
                className={`mt-3 flex items-start gap-2.5 md:mt-0 md:border-t md:border-[#c4a882]/25 md:px-1 md:pt-5 ${
                  i === 0 ? "md:border-t-0" : ""
                }`}
              >
                <CrossGlyph />
                <div>
                  <span className="mb-1 block font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#877759] md:hidden">
                    A general chatbot
                  </span>
                  <p className="text-[0.9375rem] leading-[1.55] text-[#635a48]">
                    {row.generic}
                  </p>
                </div>
              </div>

              {/* Murph */}
              <div
                className={`mt-4 flex items-start gap-2.5 rounded-2xl border border-[#7a8c6e]/25 bg-[#fffcf6] px-6 py-4 md:mt-0 md:rounded-none md:border-x md:border-b-0 md:border-t md:border-[#7a8c6e]/25 md:px-6 md:py-5 ${
                  i === 0 ? "md:border-t-0" : ""
                } ${i === ROWS.length - 1 ? "md:rounded-b-2xl md:border-b" : ""}`}
              >
                <CheckGlyph />
                <div>
                  <span className="mb-1 block font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#5a6e32] md:hidden">
                    Murph
                  </span>
                  <p className="text-[0.9375rem] leading-[1.55] text-[#2d3436]">
                    {row.murph}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
