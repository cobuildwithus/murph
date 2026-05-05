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
  expected,
  baseline,
  className,
}: MetricCardProps) {
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
        <span className={deltaVariants({ direction })}>
          {arrows[direction ?? "neutral"]} {delta}
        </span>
      </div>
      {(baseline || expected) && (
        <span className="text-xs text-muted-foreground">
          {baseline}
          {baseline && expected && " · "}
          {expected && `expected ${expected}`}
        </span>
      )}
    </div>
  );
}
