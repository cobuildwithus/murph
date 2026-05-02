"use client";

import { useState } from "react";

import { Badge } from "@/src/components/ui/badge";
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
  journal,
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
  const isInteractive = Boolean(finding || implication || caveat);
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
  const typeLabel = formatStudyType(type);

  const toggleOpen = () => {
    if (!isInteractive) {
      return;
    }

    setOpen((current) => !current);
  };

  const rowContent = (
    <div className="flex gap-4 px-6 py-5">
      <div className="hidden w-[112px] shrink-0 flex-col items-start gap-1.5 md:flex">
        {participantLabel ? (
          <Badge variant="secondary" className="font-mono text-[10px] text-primary">
            {participantLabel}
          </Badge>
        ) : null}
        <Badge
          variant="outline"
          className="font-mono text-[10px] text-muted-foreground"
          title={designLabel ? `${typeLabel}: ${designLabel}` : typeLabel}
        >
          {typeLabel}
        </Badge>
        {includedStudiesLabel ? (
          <Badge variant="outline" className="font-mono text-[9px] text-muted-foreground/75">
            {includedStudiesLabel}
          </Badge>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5 md:hidden">
          <Badge
            variant="outline"
            className="font-mono text-[10px] text-muted-foreground"
            title={designLabel ? `${typeLabel}: ${designLabel}` : typeLabel}
          >
            {typeLabel}
          </Badge>
          {participantLabel ? (
            <Badge variant="secondary" className="font-mono text-[10px] text-primary">
              {participantLabel}
            </Badge>
          ) : null}
          {includedStudiesLabel ? (
            <Badge variant="outline" className="font-mono text-[9px] text-muted-foreground/75">
              {includedStudiesLabel}
            </Badge>
          ) : null}
          {yearLabel ? (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              {yearLabel}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="min-w-0 text-sm/5 font-semibold text-foreground">
            {title}
          </span>
          {yearLabel ? (
            <Badge variant="outline" className="hidden shrink-0 font-mono text-[10px] text-muted-foreground md:inline-flex">
              {yearLabel}
            </Badge>
          ) : null}
        </div>
        {(authors || journal) ? (
          <div className="mt-1 flex flex-col gap-0.5 text-[11px]/4 text-muted-foreground/70">
            {authors ? <span>{authors}</span> : null}
            {journal ? <span>{journal}</span> : null}
          </div>
        ) : null}
        {headline ? (
          <p className="mt-2 max-w-[62ch] text-[13px]/5 text-foreground/82">
            {headline}
          </p>
        ) : null}
        {studyFacts.length > 0 ? (
          <dl className="mt-2 grid gap-2 sm:grid-cols-3">
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
            {resultLabel ? <Badge variant="outline" className="text-[10px] text-muted-foreground">{resultLabel}</Badge> : null}
            {scopeLabel ? <Badge variant="outline" className="text-[10px] text-muted-foreground">{scopeLabel}</Badge> : null}
            {stanceLabel ? <Badge variant="outline" className="text-[10px] text-muted-foreground">{stanceLabel}</Badge> : null}
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
        {isInteractive ? (
          <CollapsibleContent className="px-6 pb-5">
            <div className="flex max-w-[62ch] flex-col gap-3 pl-[128px]">
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

function formatStudyType(type: Study["type"]): string {
  switch (type) {
    case "RCT":
      return "Randomized";
    case "INT":
      return "Trial";
    case "OBS":
      return "Observed";
    case "N1":
      return "Self-test";
    case "MECH":
      return "Mechanism";
    case "MA":
      return "Meta-analysis";
    case "REV":
      return "Review";
    case "GUIDE":
      return "Guidance";
    case "SRC":
      return "Source";
  }
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

  const prefix = participantCountKind === "approximate"
    ? "n≈"
    : participantCountKind === "range"
      ? "n~"
      : "n=";

  return `${prefix}${participants.toLocaleString()}`;
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
      return "Mixed result";
    case "no_clear_advantage":
      return "No clear advantage";
    case "negative":
      return "Negative result";
    case "not_efficacy_evidence":
      return "Not outcome proof";
    case undefined:
      return "";
  }
}

function formatEvidenceScope(scope: Study["scope"]): string {
  switch (scope) {
    case "direct_protocol":
      return "Exact protocol match";
    case "same_mechanism":
      return "Similar, not exact";
    case "clinical_supervised":
      return "Supervised clinical setting";
    case "adjacent_variant":
      return "Nearby but different protocol";
    case "measurement_context":
      return "Helps run the session";
    case "general_guideline":
      return "General exercise guidance";
    case undefined:
      return "";
  }
}

function formatEvidenceStance(stance: Study["stance"]): string {
  switch (stance) {
    case "supports":
      return "Supports";
    case "mixed":
      return "Mixed evidence";
    case "does_not_confirm":
      return "Doesn't confirm";
    case "contradicts":
      return "Evidence against";
    case "safety_boundary":
      return "Safety boundary";
    case "context_only":
      return "Context, not proof";
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
