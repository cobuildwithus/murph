interface SafetySectionProps {
  cautionLevel: number;
  whoShouldAvoid: string[];
  precautions: string[];
}

export function SafetySection({
  cautionLevel,
  whoShouldAvoid,
  precautions,
}: SafetySectionProps) {
  return (
    <div id="safety-section" className="flex flex-col gap-5 rounded-xl border border-destructive/20 bg-destructive/4 p-6 scroll-mt-8">
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-4">
          Safety
        </span>
        <CautionRuler level={cautionLevel} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-destructive">
            Who should avoid
          </span>
          <ul role="list" className="flex flex-col gap-1.5">
            {whoShouldAvoid.map((item) => (
              <li key={item} className="flex gap-2 text-sm/5 text-destructive">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-destructive" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-destructive">
            Precautions
          </span>
          <ul role="list" className="flex flex-col gap-1.5">
            {precautions.map((item) => (
              <li key={item} className="flex gap-2 text-sm/5 text-destructive">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-destructive" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CautionRuler({ level }: { level: number }) {
  const clamped = Math.max(1, Math.min(5, level));
  const percent = ((clamped - 0.5) / 5) * 100;
  const label =
    clamped <= 2 ? "Low caution" : clamped <= 3 ? "Moderate caution" : "High caution";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between font-mono text-[10px]/3 uppercase tracking-[0.08em] text-muted-foreground">
        <span>Low</span>
        <span>Moderate</span>
        <span>High caution</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary/30">
        <div className="absolute inset-y-0 left-0 w-2/5 bg-primary/50" />
        <div className="absolute inset-y-0 left-2/5 w-1/5 bg-[#c4a060]/70" />
        <div className="absolute inset-y-0 left-3/5 w-2/5 bg-destructive/60" />
        <div
          aria-hidden="true"
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
          style={{ left: `${percent}%` }}
        />
      </div>
      <span className="self-end font-mono text-[11px]/4 font-semibold text-destructive">
        {label}
      </span>
    </div>
  );
}
