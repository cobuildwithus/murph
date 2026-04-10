const trustMessages = [
  "Works on Telegram, Linq, and email",
  "Syncs with Garmin, Oura, and WHOOP",
  "Plain English — no jargon",
  "Encrypted cloud snapshots for hosted runs",
] as const;

export function TrustStrip() {
  return (
    <div className="overflow-hidden border-t border-stone-200">
      <div className="animate-marquee flex whitespace-nowrap py-4">
        {Array.from({ length: 2 }).map((_, repeat) => (
          <div key={repeat} className="flex shrink-0 items-center gap-10 px-5">
            {trustMessages.map((text) => (
              <span
                key={`${repeat}-${text}`}
                className="flex items-center gap-3 text-sm text-stone-400"
              >
                <span className="h-1 w-1 bg-olive/40" aria-hidden="true" />
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
