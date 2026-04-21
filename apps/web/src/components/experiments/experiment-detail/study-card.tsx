"use client";

import { useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/src/components/ui/collapsible";
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
  includedStudyCount,
  population,
  duration,
  designLabel,
  url,
  finding,
  last,
}: StudyCardProps) {
  const [open, setOpen] = useState(false);
  const yearLabel = typeof year === "number" ? year.toString() : null;
  const participantLabel = formatParticipantLabel({
    participants,
  });
  const includedStudiesLabel = formatIncludedStudiesLabel(includedStudyCount);
  const metadata = formatMetadata([
    authors,
    journal,
    population,
    duration,
  ]);
  const rowContent = (
    <div className="flex gap-4 px-6 py-5">
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
        {finding && !open ? (
          <span className="max-w-[34ch] line-clamp-1 pt-1 text-[11px]/4 text-muted-foreground/85">
            {finding}
          </span>
        ) : null}
        <span className="mt-0.5 text-[11px]/4 text-muted-foreground/70">{metadata}</span>
      </div>
    </div>
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(!last && "border-b border-border")}
    >
      {finding ? (
        <CollapsibleTrigger
          className={cn(
            "w-full text-left transition-colors outline-none hover:bg-secondary/8 focus-visible:bg-secondary/8 cursor-pointer",
            open && "bg-secondary/8",
          )}
        >
          {rowContent}
        </CollapsibleTrigger>
      ) : rowContent}
      {finding ? (
        <CollapsibleContent className="px-6 pb-5">
          <div className="pl-[90px]">
            <p className="max-w-[52ch] text-[15px]/6 text-foreground/90">
              {finding}
            </p>
          </div>
        </CollapsibleContent>
      ) : null}
      {url ? (
        <div className="px-6 pb-5">
          <div className="pl-[90px]">
            <a
              href={url}
              className="text-xs/4 text-primary underline-offset-4 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Source ↗
            </a>
          </div>
        </div>
      ) : null}
    </Collapsible>
  );
}

function formatParticipantLabel({
  participants,
}: Pick<Study, "participants">): string | null {
  return typeof participants === "number"
    ? `n=${participants.toLocaleString()}`
    : null;
}

function formatIncludedStudiesLabel(includedStudyCount: Study["includedStudyCount"]): string | null {
  return typeof includedStudyCount === "number"
    ? `${includedStudyCount.toLocaleString()} ${includedStudyCount === 1 ? "study" : "studies"}`
    : null;
}

function formatMetadata(parts: Array<string | undefined>): string {
  const seen = new Set<string>();

  return parts
    .flatMap((part) => {
      const trimmed = part?.trim();
      return trimmed ? [trimmed] : [];
    })
    .filter((part) => {
      const normalized = part.toLocaleLowerCase();

      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .join(" · ");
}
