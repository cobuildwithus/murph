import { cn } from "@/src/lib/utils";

const sentimentClassName: Record<string, string> = {
  positive: "ml-2 text-sm font-semibold tabular-nums text-primary",
  negative: "ml-2 text-sm font-semibold tabular-nums text-amber-600",
  neutral: "ml-2 text-sm font-semibold tabular-nums text-muted-foreground",
};

const arrows: Record<string, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
};

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  direction?: "up" | "down" | "neutral" | null;
  deltaTone?: "directional" | "neutral";
  sentiment?: "positive" | "negative" | "neutral";
  expected?: string;
  baseline?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  delta,
  direction = "neutral",
  deltaTone = "directional",
  sentiment,
  expected,
  baseline,
  className,
}: MetricCardProps) {
  const footer = [baseline, expected ? `expected ${expected}` : null]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-xl bg-muted/50 p-5",
        className
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-widest text-foreground/50">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-serif text-3xl font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {unit && <span className="text-sm text-foreground/50">{unit}</span>}
        {delta ? (
          <span className={resolveDeltaClassName(deltaTone, direction, sentiment)}>
            {arrows[direction ?? "neutral"]} {delta}
          </span>
        ) : null}
      </div>
      {footer ? (
        <span
          className="block min-w-0 max-w-full truncate text-xs tabular-nums text-foreground/45"
          title={footer}
        >
          {footer}
        </span>
      ) : null}
    </div>
  );
}

function resolveDeltaClassName(
  deltaTone: "directional" | "neutral",
  direction: "up" | "down" | "neutral" | null | undefined,
  sentiment: "positive" | "negative" | "neutral" | undefined,
): string {
  if (deltaTone === "neutral") {
    return sentimentClassName.neutral;
  }

  if (sentiment) {
    return sentimentClassName[sentiment];
  }

  const fallback = direction === "up" ? "positive" : direction === "down" ? "negative" : "neutral";
  return sentimentClassName[fallback];
}
