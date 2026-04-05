const faqItems = [
  {
    question: "Do I need to download an app?",
    answer: "No. Murph works through iMessage, Telegram, or email — tools you already have.",
  },
  {
    question: "How does wearable syncing work?",
    answer: "You connect Garmin, Oura, or WHOOP once for ongoing sync.",
  },
  {
    question: "Is my health data private?",
    answer: "Yes. Local mode keeps your data on your device, and hosted runs use encrypted cloud snapshots. We never sell or share your health information with third parties.",
  },
  {
    question: "What can I ask Murph?",
    answer: "Anything about your health. Log meals, ask about supplement timing, check sleep trends, get pre-workout food suggestions — all in plain English.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Run it locally for free on your Mac or Linux computer. The managed version is just $5/month for always-online Murph and full privacy-preserving design.",
  },
] as const;

export function FaqSection() {
  return (
    <section className="border-t border-stone-200">
      <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
        <div className="grid items-start gap-12 lg:grid-cols-[280px_1fr] lg:gap-20">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-olive">
              FAQ
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-stone-900 md:text-4xl">
              Common questions.
            </h2>
          </div>
          <div className="divide-y divide-stone-200">
            {faqItems.map((item) => (
              <details key={item.question} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-6 text-left md:py-7 [&::-webkit-details-marker]:hidden">
                  <h3 className="text-lg font-semibold text-stone-900 transition-colors group-hover:text-olive">
                    {item.question}
                  </h3>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-200 text-stone-400 transition-all group-open:rotate-45 group-open:border-olive group-open:text-olive" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="pb-6 pr-12 leading-relaxed text-stone-400 md:pb-7">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
