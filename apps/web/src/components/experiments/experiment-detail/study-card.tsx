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
  participantCountKind,
  includedStudyCount,
  population,
  duration,
  designLabel,
  result,
  scope,
  stance,
  url,
  headline,
  finding,
  findingKind,
  implication,
  caveat,
  last,
}: StudyCardProps) {
  const [open, setOpen] = useState(false);
  const isInteractive = Boolean(headline || finding || implication || caveat);
  const yearLabel = typeof year === "number" ? year.toString() : null;
  const participantLabel = formatParticipantLabel({
    participantCountKind,
    participants,
  });
  const includedStudiesLabel = formatIncludedStudiesLabel(includedStudyCount);
  const studyFacts = buildStudyFacts({
    population,
    duration,
  });
  const resultLabel = result ? formatStudyResult(result) : null;
  const scopeLabel = scope ? formatEvidenceScope(scope) : null;
  const stanceLabel = stance ? formatEvidenceStance(stance) : null;
  const findingLabel = finding ? formatFindingLabel(findingKind) : null;
  const toggleOpen = () => {
    if (!isInteractive) {
      return;
    }

    setOpen((current) => !current);
  };
  const rowContent = (
    <div className="flex gap-4 px-6 py-5">
      <div className="flex w-[88px] shrink-0 flex-col items-start gap-1">
        <div
          className="h-fit rounded-md bg-primary/8 px-2.5 py-1.5"
          title={designLabel ? `${type}: ${designLabel}` : type}
        >
          <span className="font-mono text-xs/4 font-medium text-primary">
            {type}
          </span>
        </div>
        {participantLabel ? (
          <span className="rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono text-[9px]/3 text-muted-foreground/75">
            {participantLabel}
          </span>
        ) : null}
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
        {designLabel ? (
          <span className="mt-1 text-xs/4 text-muted-foreground">{designLabel}</span>
        ) : null}
        {authors ? (
          <span className="mt-1 text-[11px]/4 text-muted-foreground/70">{authors}</span>
        ) : null}
        {studyFacts.length > 0 ? (
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {studyFacts.map((fact) => (
              <div
                key={fact.label}
                className="rounded-md border border-border/60 bg-background/25 px-2.5 py-2"
              >
                <dt className="font-mono text-[9px]/3 uppercase tracking-[0.08em] text-chart-5">
                  {fact.label}
                </dt>
                <dd className="mt-0.5 text-[11px]/4 text-foreground/80">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {(resultLabel || scopeLabel || stanceLabel) ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {resultLabel ? <StudyPill>{resultLabel}</StudyPill> : null}
            {scopeLabel ? <StudyPill>{scopeLabel}</StudyPill> : null}
            {stanceLabel ? <StudyPill>{stanceLabel}</StudyPill> : null}
          </div>
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
            Open source ↗
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
        {isInteractive ? (
          <CollapsibleContent className="px-6 pb-5">
            <div className="flex max-w-[62ch] flex-col gap-3 pl-[104px]">
              {headline ? (
                <p className="text-[15px]/6 font-medium text-foreground">
                  {headline}
                </p>
              ) : null}
              {finding && findingLabel ? (
                <StudyDetail label={findingLabel} text={finding} />
              ) : null}
              {implication ? (
                <StudyDetail label="What it means here" text={implication} />
              ) : null}
              {caveat ? (
                <StudyDetail label="Important limit" text={caveat} />
              ) : null}
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}

function StudyPill({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-border/70 bg-background/35 px-2 py-0.5 text-[10px]/3.5 text-muted-foreground">
      {children}
    </span>
  );
}

function StudyDetail({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
        {label}
      </span>
      <p className="text-[14px]/6 text-foreground/85">{text}</p>
    </div>
  );
}

function formatFindingLabel(findingKind: Study["findingKind"]): string {
  switch (findingKind) {
    case "why_it_matters":
      return "Why it matters";
    case "protocol_takeaway":
      return "Protocol takeaway";
    case "finding":
    case undefined:
      return "What they found";
  }
}

function formatParticipantLabel({
  participantCountKind,
  participants,
}: Pick<Study, "participantCountKind" | "participants">): string | null {
  if (typeof participants !== "number") {
    return null;
  }

  const countLabel = `${participants.toLocaleString()} ${participants === 1 ? "person" : "people"}`;
  return participantCountKind === "approximate" ? `≈${countLabel}` : countLabel;
}

function formatIncludedStudiesLabel(includedStudyCount: Study["includedStudyCount"]): string | null {
  return typeof includedStudyCount === "number"
    ? `${includedStudyCount.toLocaleString()} ${includedStudyCount === 1 ? "study" : "studies"}`
    : null;
}

function formatStudyResult(result: Study["result"]): string {
  switch (result) {
    case "positive":
      return "Positive signal";
    case "mixed":
      return "Mixed";
    case "no_clear_advantage":
      return "No clear advantage";
    case "negative":
      return "Negative";
    case "not_efficacy_evidence":
      return "Context, not proof";
    case undefined:
      return "";
  }
}

function formatEvidenceScope(scope: Study["scope"]): string {
  switch (scope) {
    case "direct_protocol":
      return "Direct protocol";
    case "same_mechanism":
      return "Same mechanism";
    case "clinical_supervised":
      return "Clinician-guided";
    case "adjacent_variant":
      return "Adjacent";
    case "measurement_context":
      return "Measurement context";
    case "general_guideline":
      return "Guideline";
    case undefined:
      return "";
  }
}

function formatEvidenceStance(stance: Study["stance"]): string {
  switch (stance) {
    case "supports":
      return "Supports";
    case "mixed":
      return "Mixed";
    case "does_not_confirm":
      return "Does not confirm";
    case "contradicts":
      return "Against";
    case "safety_boundary":
      return "Boundary / safety";
    case "context_only":
      return "Context only";
    case undefined:
      return "";
  }
}

function buildStudyFacts({
  population,
  duration,
}: Pick<Study, "population" | "duration">): Array<{
  label: string;
  value: string;
}> {
  return [
    population ? { label: "People", value: population } : null,
    duration ? { label: "Timeframe", value: duration } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);
}
