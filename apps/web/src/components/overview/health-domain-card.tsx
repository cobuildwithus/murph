import { cva } from "class-variance-authority";
import { cn } from "@/src/lib/utils";
import type { HealthDomain } from "@/src/types/experiments";

const statusBadgeVariants = cva(
  "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
  {
    variants: {
      status: {
        "biggest-opportunity": "bg-primary/10 text-primary",
        "experiment-active": "bg-primary/10 text-primary",
        stable: "bg-secondary/50 text-foreground",
        "worth-attention": "bg-destructive/10 text-destructive",
        solid: "bg-secondary/50 text-foreground",
        "not-started": "bg-secondary/30 text-muted-foreground",
      },
    },
    defaultVariants: { status: "not-started" },
  }
);

const scoreVariants = cva("font-serif text-xl font-semibold leading-6", {
  variants: {
    status: {
      "biggest-opportunity": "text-destructive",
      "experiment-active": "text-primary",
      stable: "text-primary",
      "worth-attention": "text-destructive",
      solid: "text-primary",
      "not-started": "text-muted-foreground",
    },
  },
  defaultVariants: { status: "not-started" },
});

export function HealthDomainCard({
  title,
  description,
  score,
  status,
  statusLabel,
  secondaryInfo,
}: HealthDomain) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="font-serif text-base font-semibold text-foreground">
          {title}
        </span>
        <div className="flex shrink-0 flex-col items-end">
          {score != null ? (
            <>
              <span className={scoreVariants({ status })}>{score}</span>
              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground">
                score
              </span>
            </>
          ) : (
            <>
              <span className="text-xl leading-6 text-muted-foreground">—</span>
              <span className="font-mono text-[8px] uppercase tracking-widest text-transparent">
                score
              </span>
            </>
          )}
        </div>
      </div>
      <p className="text-sm leading-5 text-muted-foreground">{description}</p>
      <div className="flex items-center gap-2">
        <span className={cn(statusBadgeVariants({ status }))}>
          {statusLabel}
        </span>
        <span className="text-xs text-muted-foreground">{secondaryInfo}</span>
      </div>
    </div>
  );
}

export { statusBadgeVariants, scoreVariants };
