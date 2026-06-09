import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

export function ConnectedAccountCard(props: {
  label?: string;
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
        "flex flex-col gap-4 rounded-lg border border-[rgba(196,168,130,0.25)] bg-[rgba(255,252,246,0.9)] p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0 flex flex-col gap-1.5">
          {label ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {label}
            </span>
          ) : null}
          <span
            className={cn(
              "font-serif leading-tight tracking-tight break-words",
              isEmpty ? "text-muted-foreground" : "text-foreground",
              "text-lg",
            )}
          >
            {value}
          </span>
          {meta ? (
            <span className="text-sm leading-relaxed text-muted-foreground">{meta}</span>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsContactLink(props: {
  children?: ReactNode;
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
      <a
        href={props.href}
        aria-label={props.label}
        target={props.external ? "_blank" : undefined}
        rel={props.external ? "noreferrer" : undefined}
        className="font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        {props.children}
      </a>
    </p>
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
