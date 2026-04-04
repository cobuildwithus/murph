const capabilities = [
  {
    title: "Any chat app",
    body: "Talk to Murph on iMessage, Telegram, or email. No app to download.",
  },
  {
    title: "Wearable sync",
    body: "Pulls sleep, activity, and recovery data from Garmin, Oura, and WHOOP automatically.",
  },
  {
    title: "Persistent memory",
    body: "Remembers your meals, routines, supplements, and goals across every conversation.",
  },
  {
    title: "Pattern detection",
    body: "Connects how you sleep, eat, and move so you can see what actually works.",
  },
  {
    title: "Plain English",
    body: "Ask any health question. No jargon, no searching — just a clear, grounded answer.",
  },
  {
    title: "Always private",
    body: "Local mode keeps your data on your device. Hosted runs use encrypted cloud snapshots. Nothing is sold or shared.",
  },
] as const;

export function CapabilitiesGrid() {
  return (
    <section className="border-t border-stone-200">
      <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
        <p className="mb-12 text-sm font-semibold uppercase tracking-[0.15em] text-olive">
          What it does
        </p>
        <div className="grid gap-px bg-stone-200 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((item) => (
            <article key={item.title} className="bg-cream p-6 md:p-8">
              <h3 className="text-lg font-semibold text-stone-900">
                {item.title}
              </h3>
              <p className="mt-2 leading-relaxed text-stone-400">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
