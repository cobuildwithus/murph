import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

export function ConnectedAccountCard(props: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { action, className, label, meta, value } = props;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
        <span className="font-serif text-xl leading-tight tracking-tight text-foreground">
          {value}
        </span>
        {meta ? (
          <span className="text-sm leading-relaxed text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
