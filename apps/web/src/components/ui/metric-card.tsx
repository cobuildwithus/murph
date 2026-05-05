import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/src/lib/utils";

const deltaVariants = cva("ml-2 text-sm font-semibold", {
  variants: {
    direction: {
      up: "text-primary",
      down: "text-amber-600",
      neutral: "text-muted-foreground",
    },
  },
  defaultVariants: {
    direction: "neutral",
  },
});

const neutralDeltaClassName = "ml-2 text-sm font-semibold text-muted-foreground";

const arrows: Record<string, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
};

interface MetricCardProps extends VariantProps<typeof deltaVariants> {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  deltaTone?: "directional" | "neutral";
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
        "flex flex-1 flex-col gap-2 rounded-xl bg-muted/20 p-5",
        className
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-serif text-3xl font-semibold text-foreground">
          {value}
        </span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        <span className={deltaTone === "neutral" ? neutralDeltaClassName : deltaVariants({ direction })}>
          {arrows[direction ?? "neutral"]} {delta}
        </span>
      </div>
      {footer ? (
        <span
          className="block min-w-0 max-w-full truncate text-xs text-muted-foreground"
          title={footer}
        >
          {footer}
        </span>
      ) : null}
    </div>
  );
}
