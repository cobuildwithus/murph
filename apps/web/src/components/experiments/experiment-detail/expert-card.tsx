import type { Expert } from "@/src/types/experiments";

export function ExpertCard({ initials, name, field, quote }: Expert) {
  const hasField = field.trim().length > 0;

  return (
    <div className="flex grow shrink basis-0 items-center gap-3.5 rounded-xl border border-secondary/25 bg-card/90 px-5 py-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary">
        <span className="font-serif text-base/5 font-semibold text-muted-foreground">
          {initials}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm/4.5 font-semibold text-foreground">
          {name}
        </span>
        {hasField ? (
          <span className="text-xs/4 text-chart-5">{field}</span>
        ) : null}
        <span className="mt-0.5 text-xs/4 text-muted-foreground/70">
          {quote}
        </span>
      </div>
    </div>
  );
}
