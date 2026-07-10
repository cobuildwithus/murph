import type { ReactNode } from "react";

export function SettingsRow(props: {
  action?: ReactNode;
  empty?: boolean;
  icon?: ReactNode;
  label: string;
  meta?: ReactNode;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 first:pt-0 last:pb-0">
      {props.icon ?? <span className="block size-[18px]" aria-hidden="true" />}
      <div className="min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
          {props.label}
        </span>
        <p className={`break-words font-serif text-base tracking-tight ${props.empty ? "text-muted-foreground" : "text-foreground"}`}>
          {props.value}
        </p>
        {props.meta ? <div className="mt-1 [overflow-wrap:anywhere]">{props.meta}</div> : null}
      </div>
      {props.action ? <div className="shrink-0">{props.action}</div> : null}
    </div>
  );
}

export function SettingsRowList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}
