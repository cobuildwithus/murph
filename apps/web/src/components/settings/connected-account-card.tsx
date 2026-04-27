import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

export function ConnectedAccountCard(props: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  variant?: "default" | "empty";
  className?: string;
}) {
  const { action, className, label, meta, value, variant = "default" } = props;
  const isEmpty = variant === "empty";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card p-5",
        isEmpty && "bg-muted/40",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "font-serif text-xl leading-tight tracking-tight",
            isEmpty ? "text-muted-foreground" : "text-foreground",
          )}
        >
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

type SettingsStatusTone = "neutral" | "success" | "destructive";

export function SettingsStatusLine(props: {
  message: string | null;
  tone: SettingsStatusTone;
  className?: string;
}) {
  const toneClass =
    props.tone === "destructive"
      ? "text-destructive"
      : props.tone === "success"
        ? "text-primary"
        : "text-muted-foreground";

  return (
    <p
      role={props.tone === "destructive" ? "alert" : undefined}
      aria-live="polite"
      className={cn("min-h-[1.25rem] text-xs leading-snug", toneClass, props.className)}
    >
      {props.message}
    </p>
  );
}
