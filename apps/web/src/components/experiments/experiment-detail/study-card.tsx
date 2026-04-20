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
  return (
    <div className={cn("flex gap-4 px-6 py-5", !last && "border-b border-border")}>

      <div className="h-fit shrink-0 rounded-md bg-primary/8 px-2.5 py-1.5">
        <span className="font-mono text-xs/4 font-medium text-primary">
          {type}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm/4.5 font-semibold text-foreground">
          {title}
        </span>
        <span className="text-xs/4 text-chart-5">
          {[
            authors,
            journal,
            year,
            participants ? `n=${participants.toLocaleString()}` : null,
            duration,
          ].filter(Boolean).join(" · ")}
        </span>
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
