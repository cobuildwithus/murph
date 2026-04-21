import type { ReactNode } from "react";

import type { Experiment, ExperimentSignal } from "@/src/types/experiments";
import { ExpectedSignalCard } from "./expected-signal-card";
import { ExpertCard } from "./expert-card";
import { StudyCard } from "./study-card";
import { SafetySection } from "./safety-section";

interface ProtocolTabProps {
  experiment: Experiment;
}

export function ProtocolTab({ experiment }: ProtocolTabProps) {
  const {
    expectedSignals,
    protocolFacts,
    protocol,
    protocolTips,
    protocolKeepInMind,
    protocolLogFields,
    whyItWorks,
    experts,
    researchStats,
    studies,
    podcastLinks,
    safety,
  } = experiment;
  const baselineFact = findProtocolFact(protocolFacts, "baseline");
  const interventionFact = findProtocolFact(protocolFacts, "intervention");
  const supportingFacts = protocolFacts.filter((fact) => {
    const label = normalizeFactLabel(fact.label);
    return label !== "baseline" && label !== "intervention";
  });
  const whyItWorksParagraphs = whyItWorks
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const { contextSignals, focusSignals } = groupExpectedSignals(expectedSignals);

  return (
    <div className="flex flex-col gap-10">
      {focusSignals.length > 0 && (
        <section className="flex flex-col gap-4 pt-2">
          <div className="flex max-w-2xl flex-col gap-1.5">
            <SectionLabel>What could change</SectionLabel>
          </div>
          <div className={getFocusSignalGridClassName(focusSignals.length)}>
            {focusSignals.map((signal) => (
              <ExpectedSignalCard
                key={signal.label}
                label={signal.label}
                expected={signal.expected}
                direction={signal.direction}
                description={signal.description ?? ""}
              />
            ))}
          </div>
          <ExpectedSignalContextPills signals={contextSignals} />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <section className="flex flex-col gap-6 rounded-xl border border-secondary/25 bg-card/90 p-7">
          <SectionLabel>Run the protocol</SectionLabel>
          {protocol.length > 0 && (
            <div className="flex flex-col gap-3.5">
              <ol className="flex flex-col gap-3.5">
                {protocol.map((step) => (
                  <li
                    key={step.number}
                    className="grid gap-3.5 rounded-lg border border-border/70 bg-background/35 p-4 sm:grid-cols-[auto_1fr]"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary/15">
                      <span className="font-mono text-[11px]/3.5 text-chart-5">
                        {step.number}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {hasSpecificStepTitle(step) ? (
                        <p className="text-sm/5 font-semibold text-foreground">
                          {step.title}
                        </p>
                      ) : null}
                      <p className="text-[13px]/5 text-foreground/85">
                        {step.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <ProtocolTextList
            title="For a cleaner read"
            items={protocolTips}
          />
        </section>

        <section className="flex flex-col gap-5 rounded-xl border border-secondary/25 bg-card/90 p-7">
          <SectionLabel>At a glance</SectionLabel>

          {(baselineFact || interventionFact) && (
            <div className="flex flex-col gap-3">
              {baselineFact ? (
                <ProtocolPhaseCard
                  badge="Before change"
                  fact={baselineFact}
                />
              ) : null}
              {interventionFact ? (
                <ProtocolPhaseCard
                  badge="Protocol window"
                  fact={interventionFact}
                />
              ) : null}
            </div>
          )}

          {supportingFacts.length > 0 && (
            <dl className="overflow-hidden rounded-lg border border-border/70 bg-background/20">
              {supportingFacts.map((fact, index) => (
                <div
                  key={`${fact.label}-${fact.value}`}
                  className={`grid gap-1 px-4 py-3.5 sm:grid-cols-[88px_1fr] sm:gap-4 ${
                    index > 0 ? "border-t border-border/60" : ""
                  }`}
                >
                  <dt className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
                    {fact.label}
                  </dt>
                  <div>
                    <dd className="text-sm/5 font-semibold text-foreground">
                      {fact.value}
                    </dd>
                    {fact.detail ? (
                      <p className="mt-1 text-xs/4 text-muted-foreground">
                        {fact.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </dl>
          )}

          {protocolLogFields.length > 0 && (
            <div className="flex flex-col gap-3">
              <SectionLabel>Log each session</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {protocolLogFields.map((field) => (
                  <span
                    key={field}
                    className="rounded-full border border-border/70 bg-background/35 px-3 py-1.5 text-xs/4 text-muted-foreground"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          )}

          <ProtocolTextList title="Keep in mind" items={protocolKeepInMind} />
        </section>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-secondary/25 bg-card/90 p-7">
        <SectionLabel>Why it works</SectionLabel>
        <div
          className={`grid gap-4 ${
            whyItWorksParagraphs.length > 1 ? "lg:grid-cols-2" : ""
          }`}
        >
          {whyItWorksParagraphs.map((paragraph, i) => (
            <p
              key={i}
              className="text-[14px] leading-[170%] text-foreground/80"
            >
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      {/* Recommended by */}
      {experts.length > 0 && (
        <div className="flex flex-col gap-3.5">
          <span className="font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-5">
            RECOMMENDED BY
          </span>
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {experts.map((expert) => (
              <ExpertCard key={expert.name} {...expert} />
            ))}
          </div>
        </div>
      )}

      {/* Research */}
      <div className="flex flex-col gap-5">
        <span className="font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-5">
          RESEARCH
        </span>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {researchStats.map((stat) => (
            <div
              key={stat.label}
              className="flex grow shrink basis-0 flex-col items-center gap-1 rounded-xl border border-secondary/25 bg-card/90 p-5"
            >
              <span className="font-serif text-[32px]/10 font-semibold text-foreground">
                {typeof stat.value === "number"
                  ? stat.value.toLocaleString()
                  : stat.value}
              </span>
              <span className="font-mono text-[10px]/3 tracking-[0.08em] text-chart-5">
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Study cards - unified container */}
        {studies.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-secondary/25 bg-card/90">
            {studies.map((study, i) => (
              <StudyCard
                key={study.title}
                {...study}
                last={i === studies.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* Podcast links */}
      {podcastLinks && podcastLinks.length > 0 && (
        <div className="flex gap-2.5">
          {podcastLinks.map((link) => (
            <div
              key={link.label}
              className="flex items-center gap-2 rounded-lg bg-secondary/8 px-3.5 py-2"
            >
              <span className="font-mono text-[11px]/3.5 text-muted-foreground">
                ▶
              </span>
              <span className="text-xs/4 text-muted-foreground">
                {link.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Safety */}
      <SafetySection {...safety} />
    </div>
  );
}

const MAX_FOCUS_SIGNAL_CARDS = 3;

const signalDirectionArrows: Record<ExperimentSignal["direction"], string> = {
  down: "↓",
  neutral: "→",
  up: "↑",
};

function groupExpectedSignals(signals: readonly ExperimentSignal[]): {
  contextSignals: ExperimentSignal[];
  focusSignals: ExperimentSignal[];
} {
  const explicitFocusSignals = signals.filter(
    (signal) => signal.protocolProminence === "focus",
  );
  const undecidedSignals = signals.filter(
    (signal) => signal.protocolProminence === undefined,
  );
  const preferredFocusSignals = [
    ...explicitFocusSignals,
    ...undecidedSignals,
  ].slice(0, MAX_FOCUS_SIGNAL_CARDS);
  const focusSignals = preferredFocusSignals.length > 0
    ? preferredFocusSignals
    : signals.slice(0, MAX_FOCUS_SIGNAL_CARDS);
  const focusSignalSet = new Set(focusSignals);

  return {
    contextSignals: signals.filter((signal) => !focusSignalSet.has(signal)),
    focusSignals,
  };
}

function getFocusSignalGridClassName(count: number): string {
  if (count <= 1) {
    return "grid gap-4 md:max-w-xl";
  }

  if (count === 2) {
    return "grid gap-4 md:grid-cols-2";
  }

  return "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
}

function ExpectedSignalContextPills({
  signals,
}: {
  signals: readonly ExperimentSignal[];
}) {
  if (signals.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-secondary/25 bg-card/70 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <SectionLabel>Also worth watching</SectionLabel>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {signals.map((signal) => (
          <span
            key={signal.label}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/35 px-3 py-2 text-[12px]/4"
          >
            <span
              aria-hidden="true"
              className="font-serif text-base/4 text-primary"
            >
              {signalDirectionArrows[signal.direction]}
            </span>
            <span className="font-medium text-foreground/85">
              {signal.label}
            </span>
            <span className="text-muted-foreground">{signal.expected}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function findProtocolFact(
  facts: Experiment["protocolFacts"],
  label: string,
) {
  return facts.find((fact) => normalizeFactLabel(fact.label) === label);
}

function normalizeFactLabel(label: string): string {
  return label.trim().toLowerCase();
}

function hasSpecificStepTitle(step: Experiment["protocol"][number]): boolean {
  return step.title.trim() !== `Step ${step.number}`;
}

function ProtocolPhaseCard({
  fact,
  badge,
}: {
  fact: Experiment["protocolFacts"][number];
  badge: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
            {fact.label}
          </div>
          <div className="mt-1 text-lg/7 font-semibold text-foreground">
            {fact.value}
          </div>
        </div>
        <span className="rounded-full bg-secondary/12 px-2.5 py-1 font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
          {badge}
        </span>
      </div>
      {fact.detail ? (
        <p className="mt-3 text-sm/6 text-muted-foreground">
          {fact.detail}
        </p>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-5">
      {children}
    </span>
  );
}

function ProtocolTextList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>{title}</SectionLabel>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-2.5 text-[13px]/5 text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-secondary"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
