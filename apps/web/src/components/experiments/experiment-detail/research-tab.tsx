import type { ReactNode } from "react";

import type {
  ExperimentResearchGroup,
  ExperimentResearchStat,
  Study,
} from "@/src/types/experiments";
import { StudyCard } from "./study-card";
import { splitBulletLead } from "./format";

export interface ResearchTabExperiment {
  id: string;
  protocolKeepInMind: string[];
  researchGroups?: ExperimentResearchGroup[];
  researchLandscape?: ResearchTabLandscape;
  researchStats: ExperimentResearchStat[];
  studies: Study[];
}

export interface ResearchTabLandscape {
  bottomLine: string;
  confidenceLabel: "early" | "moderate" | "strong" | "mixed" | "limited";
  mainCaveat: string;
  primaryClaim: string;
}

interface ResearchTabProps {
  experiment: ResearchTabExperiment;
}

export function ResearchTab({ experiment }: ResearchTabProps) {
  const {
    researchStats,
    researchLandscape,
    researchGroups,
    studies,
    protocolKeepInMind,
  } = experiment;

  return (
    <div className="flex flex-col gap-8">
      {researchLandscape ? (
        <ResearchLandscapeReadout landscape={researchLandscape} />
      ) : null}

      {protocolKeepInMind.length > 0 ? (
        <ReadingResultsNotes items={protocolKeepInMind} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {researchStats.map((stat) => {
          const isHero =
            /HUMAN PARTICIPANTS/u.test(stat.label) && stat.value !== "—";
          return (
            <div
              key={stat.label}
              className={
                isHero
                  ? "order-first flex flex-col items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/5 p-5 xl:col-span-2"
                  : "flex flex-col items-center gap-1 rounded-xl border border-secondary/25 bg-card/90 p-4"
              }
            >
              <span
                className={
                  isHero
                    ? "font-serif text-[44px]/12 font-semibold text-primary"
                    : "font-serif text-[26px]/9 font-semibold text-foreground/85"
                }
              >
                {typeof stat.value === "number"
                  ? stat.value.toLocaleString()
                  : stat.value}
              </span>
              <span className="font-mono text-[10px]/3 tracking-[0.08em] text-chart-5">
                {stat.label}
              </span>
            </div>
          );
        })}
      </div>

      {researchStats.some((stat) =>
        /HUMAN PARTICIPANTS/u.test(stat.label) && stat.value !== "—",
      ) ? (
        <details className="group">
          <summary className="cursor-pointer list-none font-mono text-[10px]/3 uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              How we count
              <span aria-hidden="true" className="transition-transform group-open:rotate-180">˅</span>
            </span>
          </summary>
          <p className="mt-2 max-w-3xl text-xs/5 text-muted-foreground/70">
            Sources checked is every card shown on this page. Direct human
            participants counts only primary human studies with coded
            participant totals, deduplicated by cohort when possible. Review
            cards may show larger pooled head counts on their own rows, and
            those pooled totals are treated as approximate rather than added
            into the page-level number.
            {experiment.id === "norwegian-4x4"
              ? " On Norwegian 4x4, safety-boundary registries also stay off that page-level total."
              : ""}
          </p>
        </details>
      ) : null}

      {experiment.id === "norwegian-4x4"
        && researchGroups
        && researchGroups.length > 0 ? (
        <p className="max-w-3xl text-sm/6 text-muted-foreground/80">
          Read these top to bottom: the earliest groups are the closest match to
          the exact protocol, and the later groups mainly add safety, boundary,
          or nearby-variant context.
        </p>
      ) : null}

      {researchGroups && researchGroups.length > 0 ? (
        <div className="flex flex-col gap-4">
          {researchGroups.map((group) => (
            <ResearchGroupCard key={group.id} group={group} />
          ))}
        </div>
      ) : studies.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-secondary/25 bg-card/90">
          {studies.map((study, i) => (
            <StudyCard
              key={study.title}
              {...study}
              last={i === studies.length - 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReadingResultsNotes({ items }: { items: ReadonlyArray<string> }) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-secondary/25 bg-card/90 p-7">
      <SectionLabel>Read results carefully</SectionLabel>
      <ul
        role="list"
        className="grid gap-x-10 gap-y-6 md:grid-cols-3 md:divide-x md:divide-border/60"
      >
        {items.map((item) => {
          const { lead, rest } = splitBulletLead(item);
          return (
            <li
              key={item}
              className="flex flex-col gap-1.5 text-[14px]/6 text-foreground text-pretty md:px-6 md:first:pl-0 md:last:pr-0"
            >
              {lead ? (
                <>
                  <strong className="font-semibold text-foreground">
                    {lead}
                  </strong>
                  {rest ? (
                    <span className="text-muted-foreground">{rest}</span>
                  ) : null}
                </>
              ) : (
                <span>{item}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ResearchLandscapeReadout({
  landscape,
}: {
  landscape: NonNullable<ResearchTabExperiment["researchLandscape"]>;
}) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-secondary/25 bg-card/90 p-7">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
          Verdict
        </span>
        <ConfidenceBadge level={landscape.confidenceLabel} />
      </div>
      <p className="max-w-3xl font-serif text-xl/8 font-medium text-foreground text-pretty">
        {landscape.primaryClaim}
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
            Bottom line
          </span>
          <p className="text-sm/6 text-foreground">{landscape.bottomLine}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-4">
            Main caveat
          </span>
          <p className="text-sm/6 text-foreground">{landscape.mainCaveat}</p>
        </div>
      </div>
    </section>
  );
}

function ConfidenceBadge({
  level,
}: {
  level: NonNullable<ResearchTabExperiment["researchLandscape"]>["confidenceLabel"];
}) {
  const tone: Record<typeof level, { label: string; className: string }> = {
    early: { label: "Early", className: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
    limited: { label: "Limited", className: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
    mixed: { label: "Mixed", className: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
    moderate: {
      label: "Moderate confidence",
      className: "border-primary/40 bg-primary/10 text-primary",
    },
    strong: {
      label: "Strong confidence",
      className: "border-primary/60 bg-primary/15 text-primary",
    },
  };
  const { label, className } = tone[level];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px]/4 font-semibold uppercase tracking-[0.08em] ${className}`}
    >
      {label}
    </span>
  );
}

function ResearchGroupCard({
  group,
}: {
  group: NonNullable<ResearchTabExperiment["researchGroups"]>[number];
}) {
  const sourceMixSummary = formatResearchGroupSourceMix(group.studies);

  return (
    <details
      className="group overflow-hidden rounded-xl border border-secondary/25 bg-card/90"
      open={group.defaultOpen}
    >
      <summary className="cursor-pointer list-none px-6 py-5 transition-colors hover:bg-secondary/6 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-3xl flex-col gap-2">
            <SectionLabel>{formatResearchGroupLabel(group.id, group.label)}</SectionLabel>
            <p className="line-clamp-2 text-[14px]/6 text-foreground/80 group-open:line-clamp-none">{group.summary}</p>
            <p className="font-mono text-[10px]/3.5 tracking-[0.08em] text-muted-foreground/80">
              {sourceMixSummary}
            </p>
          </div>
          <div className="flex w-fit shrink-0 items-center gap-2 self-start sm:justify-end">
            <span className="rounded-full border border-border/70 bg-background/35 px-2.5 py-1 font-mono text-[10px]/3.5 text-muted-foreground">
              {formatEvidenceStance(group.stance)}
            </span>
            <span
              aria-hidden="true"
              className="rounded-full border border-border/70 bg-background/35 px-2 py-1 font-mono text-[10px]/3.5 text-muted-foreground transition-transform group-open:rotate-180"
            >
              ˅
            </span>
          </div>
        </div>
      </summary>
      <div className="border-t border-border/70">
        {group.studies.map((study, index) => (
          <StudyCard
            key={`${group.id}-${study.title}`}
            {...study}
            last={index === group.studies.length - 1}
          />
        ))}
      </div>
    </details>
  );
}

function formatResearchGroupLabel(id: string, fallbackLabel: string): string {
  switch (id) {
    case "evidence-backbone-and-claim-calibration":
      return "What the evidence can and can't say";
    case "near-term-autonomic-vascular-and-immune-signals":
      return "Short-term signals to watch";
    case "long-term-finnish-cohort-and-real-world-context":
      return "Long-term Finnish population context";
    case "intervention-design-training-and-mixed-results":
      return "Repeated-use trials and mixed results";
    case "safety-dose-modality-and-context-boundaries":
      return "Safety, dose, and sauna type";
    default:
      return fallbackLabel;
  }
}

function formatResearchGroupSourceMix(
  studies: NonNullable<ResearchTabExperiment["researchGroups"]>[number]["studies"],
): string {
  const sourceCount = studies.length;
  const categoryCounts = [
    { count: countStudiesByType(studies, ["MECH"]), pluralLabel: "physiology studies", singularLabel: "physiology study", sortOrder: 0 },
    { count: countStudiesByType(studies, ["RCT", "INT"]), pluralLabel: "trials", singularLabel: "trial", sortOrder: 1 },
    { count: countStudiesByType(studies, ["OBS"]), pluralLabel: "observational studies", singularLabel: "observational study", sortOrder: 2 },
    { count: countStudiesByType(studies, ["MA", "REV"]), pluralLabel: "reviews", singularLabel: "review", sortOrder: 3 },
    { count: countStudiesByType(studies, ["GUIDE"]), pluralLabel: "guidance sources", singularLabel: "guidance source", sortOrder: 4 },
    { count: countStudiesByType(studies, ["N1"]), pluralLabel: "self-experiments", singularLabel: "self-experiment", sortOrder: 5 },
    { count: countStudiesByType(studies, ["SRC"]), pluralLabel: "supporting sources", singularLabel: "supporting source", sortOrder: 6 },
  ]
    .filter((category) => category.count > 0)
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.sortOrder - right.sortOrder;
    })
    .slice(0, 3)
    .map((category) =>
      `${category.count.toLocaleString()} ${category.count === 1 ? category.singularLabel : category.pluralLabel}`,
    );

  return [
    `${sourceCount.toLocaleString()} ${sourceCount === 1 ? "source" : "sources"}`,
    ...categoryCounts,
  ].join(" · ");
}

function countStudiesByType(
  studies: NonNullable<ResearchTabExperiment["researchGroups"]>[number]["studies"],
  includedTypes: readonly ResearchTabExperiment["studies"][number]["type"][],
): number {
  return studies.filter((study) => includedTypes.includes(study.type)).length;
}

function formatEvidenceStance(
  stance: NonNullable<ResearchTabExperiment["researchGroups"]>[number]["stance"],
): string {
  switch (stance) {
    case "supports": return "Supports";
    case "mixed": return "Mixed evidence";
    case "does_not_confirm": return "Doesn't confirm";
    case "contradicts": return "Evidence against";
    case "safety_boundary": return "Safety boundary";
    case "context_only": return "Context, not proof";
  }
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-5">
      {children}
    </span>
  );
}
