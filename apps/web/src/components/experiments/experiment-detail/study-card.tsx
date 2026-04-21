"use client";

import { useState } from "react";

import { Collapsible, CollapsibleContent } from "@/src/components/ui/collapsible";
import { cn } from "@/src/lib/utils";
import type { Study } from "@/src/types/experiments";

interface StudyCardProps extends Study {
  last?: boolean;
}

export function StudyCard({
  type,
  title,
  authors,
  year,
  participants,
  includedStudyCount,
  designLabel,
  url,
  finding,
  last,
}: StudyCardProps) {
  const [open, setOpen] = useState(false);
  const isInteractive = Boolean(finding);
  const yearLabel = typeof year === "number" ? year.toString() : null;
  const participantLabel = formatParticipantLabel({
    participants,
  });
  const includedStudiesLabel = formatIncludedStudiesLabel(includedStudyCount);
  const toggleOpen = () => {
    if (!isInteractive) {
      return;
    }

    setOpen((current) => !current);
  };
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
        {authors ? (
          <span className="mt-1 text-[11px]/4 text-muted-foreground/70">{authors}</span>
        ) : null}
        {url ? (
          <a
            href={url}
            className="mt-1 w-fit text-xs/4 text-primary underline-offset-4 hover:underline"
            onClick={(event) => {
              event.stopPropagation();
            }}
            rel="noreferrer"
            target="_blank"
          >
            Source ↗
          </a>
        ) : null}
      </div>
    </div>
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(!last && "border-b border-border")}
    >
      <div
        aria-expanded={isInteractive ? open : undefined}
        className={cn(
          "transition-colors",
          isInteractive && "cursor-pointer hover:bg-secondary/8 focus-visible:bg-secondary/8",
          open && "bg-secondary/8",
        )}
        data-slot={isInteractive ? "study-card-trigger" : undefined}
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (!isInteractive) {
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleOpen();
          }
        }}
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
      >
        {rowContent}
        {finding ? (
          <CollapsibleContent className="px-6 pb-5">
            <div className="pl-[90px]">
              <p className="max-w-[52ch] text-[15px]/6 text-foreground/90">
                {finding}
              </p>
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
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
