import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

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
  announce?: boolean;
  message: string | null;
  tone: SettingsStatusTone;
  className?: string;
}) {
  const announce = props.announce ?? true;
  const toneClass =
    props.tone === "destructive"
      ? "text-destructive"
      : props.tone === "success"
        ? "text-primary"
        : "text-muted-foreground";

  return (
    <p
      role={announce && props.tone === "destructive" ? "alert" : undefined}
      aria-live={announce
        ? props.tone === "destructive" ? "assertive" : "polite"
        : undefined}
      className={cn("min-h-[1.25rem] text-xs leading-snug", toneClass, props.className)}
    >
      {props.message}
    </p>
  );
}
