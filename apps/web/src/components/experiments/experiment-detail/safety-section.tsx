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
    <div className="flex flex-col gap-3.5 rounded-xl border border-destructive/20 bg-destructive/4 p-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-4">
          SAFETY
        </span>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className={`size-2 rounded-full ${
                i < cautionLevel ? "bg-[#C4A060]" : "bg-secondary"
              }`}
            />
          ))}
          <span className="ml-1 font-mono text-[10px]/3 text-chart-4">
            {cautionLevel <= 2
              ? "Low caution"
              : cautionLevel <= 3
                ? "Moderate caution"
                : "High caution"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px]/4 font-semibold text-destructive">
          Who should avoid
        </span>
        <span className="text-[13px] leading-[155%] text-destructive">
          {whoShouldAvoid.join(" · ")}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px]/4 font-semibold text-destructive">
          Precautions
        </span>
        <span className="text-[13px] leading-[155%] text-destructive">
          {precautions.join(" ")}
        </span>
      </div>
    </div>
  );
}
