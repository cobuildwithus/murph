import type { ReactNode } from "react";

export function HostedGroupStartFrame({
  body,
  children,
  icon,
  title,
}: {
  body: string;
  children?: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-8 text-center">
      <header className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          {icon}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-pretty text-base leading-7 text-muted-foreground">
            {body}
          </p>
        </div>
      </header>
      {children ? <div className="flex flex-col gap-3">{children}</div> : null}
    </div>
  );
}
