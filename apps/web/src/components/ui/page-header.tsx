import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      {typeof eyebrow === "string" ? (
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </span>
      ) : eyebrow ?? null}
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance text-foreground">
        {title}
      </h1>
      {description ? (
        <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}
