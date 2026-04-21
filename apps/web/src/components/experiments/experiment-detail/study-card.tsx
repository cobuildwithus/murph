import { cn } from "@/src/lib/utils";
import type { Study } from "@/src/types/experiments";

interface StudyCardProps extends Study {
  last?: boolean;
}

export function StudyCard({
  type,
  title,
  authors,
  journal,
  year,
  participants,
  duration,
  url,
  finding,
  last,
}: StudyCardProps) {
  const badgeLabel = typeof year === "number" ? year.toString() : type;
  const sampleLabel = participants ? `n=${participants.toLocaleString()}` : null;
  const metadata = [
    authors,
    journal,
    duration,
  ].filter(Boolean).join(" · ");

  return (
    <div className={cn("flex gap-4 px-6 py-5", !last && "border-b border-border")}>
      <div className="h-fit shrink-0 rounded-md bg-primary/8 px-2.5 py-1.5">
        <span className="font-mono text-xs/4 font-medium text-primary">
          {badgeLabel}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-4">
          <span className="min-w-0 text-sm/4.5 font-semibold text-foreground">
            {title}
          </span>
          {sampleLabel ? (
            <span className="shrink-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px]/3.5 text-muted-foreground">
              {sampleLabel}
            </span>
          ) : null}
        </div>
        <span className="text-xs/4 text-chart-5">{metadata}</span>
        <span className="mt-0.5 text-xs/4 text-muted-foreground/70">{finding}</span>
        {url ? (
          <a
            href={url}
            className="mt-1 text-xs/4 text-primary underline-offset-4 hover:underline"
            rel="noreferrer"
            target="_blank"
          >
            Source ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
