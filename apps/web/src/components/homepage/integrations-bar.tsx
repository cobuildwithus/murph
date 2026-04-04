const integrations = [
  "iMessage", "Telegram", "Email", "Garmin", "Oura", "WHOOP",
] as const;

export function IntegrationsBar() {
  return (
    <section className="border-t border-stone-200">
      <div className="mx-auto max-w-7xl px-6 py-12 md:px-12 lg:px-16">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-olive">
            Works with
          </p>
          {integrations.map((name) => (
            <span
              key={name}
              className="border border-stone-200 px-4 py-2 text-sm font-medium text-stone-500"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
