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
  participantCountKind,
  includedStudyCount,
  population,
  duration,
  designLabel,
  url,
  finding,
  last,
}: StudyCardProps) {
  const yearLabel = typeof year === "number" ? year.toString() : null;
  const participantLabel = formatParticipantLabel({
    participantCountKind,
    participants,
  });
  const includedStudiesLabel = formatIncludedStudiesLabel(includedStudyCount);
  const metadata = [
    authors,
    journal,
    population,
    duration,
  ].filter(Boolean).join(" · ");

  return (
    <div className={cn("flex gap-4 px-6 py-5", !last && "border-b border-border")}>
      <div className="flex w-[74px] shrink-0 flex-col items-start gap-1">
        <div
          className="h-fit rounded-md bg-primary/8 px-2.5 py-1.5"
          title={designLabel ? `${type}: ${designLabel}` : type}
        >
          <span className="font-mono text-xs/4 font-medium text-primary">
            {participantLabel ?? type}
          </span>
        </div>
        {includedStudiesLabel ? (
          <span className="rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono text-[9px]/3 text-muted-foreground/75">
            {includedStudiesLabel}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-4">
          <span className="min-w-0 text-sm/4.5 font-semibold text-foreground">
            {title}
          </span>
          {yearLabel ? (
            <span className="shrink-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px]/3.5 text-muted-foreground">
              {yearLabel}
            </span>
          ) : null}
        </div>
        <span className="text-[13px]/5 text-foreground/85">{finding}</span>
        <span className="mt-0.5 text-[11px]/4 text-muted-foreground/70">{metadata}</span>
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

function formatParticipantLabel({
  participantCountKind,
  participants,
}: Pick<Study, "participantCountKind" | "participants">): string | null {
  const participantPrefix =
    participantCountKind === "approximate" || participantCountKind === "range" ? "n≈" : "n=";

  return typeof participants === "number"
    ? `${participantPrefix}${participants.toLocaleString()}`
    : null;
}

function formatIncludedStudiesLabel(includedStudyCount: Study["includedStudyCount"]): string | null {
  return typeof includedStudyCount === "number"
    ? `${includedStudyCount.toLocaleString()} ${includedStudyCount === 1 ? "study" : "studies"}`
    : null;
}
