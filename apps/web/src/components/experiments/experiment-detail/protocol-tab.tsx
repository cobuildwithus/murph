import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  HeartPulse,
  NotebookPen,
  Repeat,
  ShieldAlert,
  Target,
  Timer,
} from "lucide-react";

import type {
  Expert,
  ExperimentMeasurementPath,
  ExperimentProtocolFact,
  ExperimentProtocolStep,
  ExperimentSafety,
  ExperimentSignal,
} from "@/src/types/experiments";
import { ExpertCard } from "./expert-card";
import { SafetySection } from "./safety-section";
import { splitBulletLead } from "./format";

interface ProtocolTabProps {
  experiment: ProtocolTabExperiment;
  researchHref?: string;
}

export interface ProtocolTabExperiment {
  baselineDays: number;
  durationDays: number;
  expectedSignals: ExperimentSignal[];
  experts: Expert[];
  id: string;
  measurementPaths: ExperimentMeasurementPath[];
  podcastLinks?: { label: string; url: string }[];
  protocol: ExperimentProtocolStep[];
  protocolFacts: ExperimentProtocolFact[];
  protocolTips: string[];
  safety: ExperimentSafety;
  whyItWorks: string;
}

interface SignalEstimate {
  range: string;
  point: string;
  window: string;
  baseline: string;
  projected: string;
  evidence: string;
}

const SIGNAL_ESTIMATES: Record<string, SignalEstimate> = {
  "Resting Heart Rate": {
    range: "−5–10%",
    point: "~−8%",
    window: "4–8 wks",
    baseline: "~62 bpm",
    projected: "~56 bpm",
    evidence: "Moderate",
  },
  "Morning Blood Pressure": {
    range: "−3–5 mmHg",
    point: "~−4 mmHg",
    window: "4–8 wks",
    baseline: "~120/80",
    projected: "~115/75",
    evidence: "Moderate",
  },
  "HRV / RMSSD": {
    range: "+3–7 ms",
    point: "~+5 ms",
    window: "4–8 wks",
    baseline: "~45 ms",
    projected: "~48 ms",
    evidence: "Variable",
  },
};
const PRACTICE_ICONS = [
  Repeat,
  ShieldAlert,
  NotebookPen,
  Target,
  HeartPulse,
  Timer,
];

function practiceGridCols(count: number): string {
  switch (count) {
    case 1:
      return "";
    case 2:
      return "md:grid-cols-2";
    case 3:
      return "md:grid-cols-2 lg:grid-cols-3";
    case 4:
      return "md:grid-cols-2 lg:grid-cols-4";
    default:
      return "md:grid-cols-2 lg:grid-cols-3";
  }
}

const SIGNAL_ESTIMATE_FALLBACK: SignalEstimate = {
  range: "—",
  point: "—",
  window: "4–8 wks",
  baseline: "Baseline",
  projected: "Projected",
  evidence: "Indicative",
};

function getSignalEstimate(signal: ExperimentSignal): SignalEstimate {
  const estimate = SIGNAL_ESTIMATES[signal.label];
  if (estimate) return estimate;
  return {
    ...SIGNAL_ESTIMATE_FALLBACK,
    range: signal.expected,
    point: signal.expected,
  };
}

interface TrajectoryChartProps {
  direction: "up" | "down" | "neutral";
  baseline: string;
  projected: string;
  height: number;
  label: string;
}

const TRAJECTORY_GEOMETRY: Record<
  TrajectoryChartProps["direction"],
  { baselineY: number; projectedY: number; curveD: string }
> = {
  up: {
    baselineY: 44,
    projectedY: 14,
    curveD: "M 5 44 C 60 43 130 18 215 14",
  },
  down: {
    baselineY: 14,
    projectedY: 44,
    curveD: "M 5 14 C 60 15 130 40 215 44",
  },
  neutral: {
    baselineY: 28,
    projectedY: 28,
    curveD: "M 5 28 C 60 27 110 29 160 27 215 28",
  },
};

function TrajectoryChart({
  direction,
  baseline,
  projected,
  height,
  label,
}: TrajectoryChartProps) {
  const isNeutral = direction === "neutral";
  const { baselineY, projectedY, curveD } = TRAJECTORY_GEOMETRY[direction];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <span className="font-serif text-[13px] text-foreground tabular-nums">
          {baseline}
        </span>
        <span className="font-serif text-[13px] text-primary tabular-nums">
          {projected}
        </span>
      </div>
      <svg
        role="img"
        aria-label={label}
        width="100%"
        height={height}
        viewBox="0 0 220 60"
        className="shrink-0 overflow-visible"
      >
        <line
          x1="0"
          y1={baselineY}
          x2="220"
          y2={baselineY}
          stroke="var(--secondary)"
          strokeDasharray="3,4"
          strokeWidth="1"
        />
        {isNeutral ? (
          <>
            <path
              d="M 5 28 C 70 26 140 18 215 14"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.25"
              strokeDasharray="2,3"
              opacity="0.55"
            />
            <path
              d="M 5 28 C 70 30 140 38 215 42"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.25"
              strokeDasharray="2,3"
              opacity="0.55"
            />
          </>
        ) : (
          <line
            x1="110"
            y1={projectedY}
            x2="220"
            y2={projectedY}
            stroke="var(--primary)"
            strokeDasharray="2,4"
            strokeWidth="0.75"
            opacity="0.5"
          />
        )}
        <path
          d={curveD}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle
          cx="5"
          cy={baselineY}
          r="3.5"
          fill="var(--card)"
          stroke="var(--secondary)"
          strokeWidth="1.75"
        />
        {isNeutral ? (
          <circle cx="215" cy="28" r="3.5" fill="var(--primary)" opacity="0.55" />
        ) : (
          <circle cx="215" cy={projectedY} r="3.5" fill="var(--primary)" />
        )}
      </svg>
      <div className="flex items-center justify-between gap-3 px-0.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          Start
        </span>
        <span className="h-px flex-1 border-t border-dotted border-border/50" />
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          Week 8
        </span>
      </div>
    </div>
  );
}

export function ProtocolTab({ experiment, researchHref }: ProtocolTabProps) {
  const {
    expectedSignals,
    measurementPaths,
    protocolFacts,
    protocol,
    protocolTips,
    whyItWorks,
    experts,
    podcastLinks,
    safety,
  } = experiment;
  const baselineFact = findProtocolFact(protocolFacts, "baseline");
  const interventionFact = findProtocolFact(protocolFacts, "intervention");
  const supportingFacts = protocolFacts.filter((fact) => {
    const label = normalizeFactLabel(fact.label);
    return label !== "baseline" && label !== "intervention";
  });
  const frequencyFact = supportingFacts.find(
    (fact) => normalizeFactLabel(fact.label) === "frequency",
  );
  const sessionsPerWeek = frequencyFact
    ? Math.max(
        1,
        Math.min(7, Number.parseInt(frequencyFact.value.match(/\d+/)?.[0] ?? "3", 10)),
      )
    : 3;
  const scheduleEntries = interventionFact?.detail
    ? parseSessionCounts(interventionFact.detail)
    : [];
  const whyItWorksParagraphs = whyItWorks
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const { contextSignals, focusSignals } = groupExpectedSignals(expectedSignals);

  return (
    <div className="flex flex-col gap-10">
      {focusSignals.length > 0 && (
        <section className="flex flex-col gap-4 pt-2">
          <SectionLabel>What could change</SectionLabel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {focusSignals.map((signal, idx) => {
              const est = getSignalEstimate(signal);
              const isPrimary = idx === 0;
              const isNeutral = signal.direction === "neutral";
              return (
                <div
                  key={signal.label}
                  data-card={signal.label}
                  className={`flex flex-col rounded-xl border ${
                    isPrimary
                      ? "xl:col-span-2 gap-5 pt-7 px-7 pb-5 border-primary/25 bg-primary/[0.04]"
                      : "gap-4 p-5 border-border/60 bg-card/90"
                  }`}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                    {isPrimary ? "Primary signal" : "Signal"}
                  </span>

                  <div className="flex flex-col gap-2">
                    <h3
                      className={`font-serif font-semibold text-foreground ${
                        isPrimary ? "text-2xl" : "text-lg"
                      }`}
                    >
                      {signal.label}
                    </h3>
                    <p
                      className={`font-serif font-semibold text-primary ${
                        isPrimary ? "text-4xl" : "text-2xl"
                      }`}
                    >
                      {est.range}
                    </p>
                    <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-foreground/60">
                      over {est.window}
                    </p>
                  </div>

                  <p
                    className={`text-foreground text-pretty ${
                      isPrimary ? "text-[15px]/6" : "text-sm/5.5"
                    }`}
                  >
                    {signal.description ?? ""}
                  </p>

                  <div className="mt-auto flex flex-col gap-3">
                    <TrajectoryChart
                      direction={signal.direction}
                      baseline={est.baseline}
                      projected={est.projected}
                      height={isPrimary ? 108 : 84}
                      label={`${signal.label} projected ${est.point} over ${est.window}`}
                    />

                    <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className={`size-1 rounded-full ${
                          isNeutral ? "bg-secondary" : "bg-primary/60"
                        }`}
                      />
                      {est.evidence.toLowerCase()} evidence
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <ExpectedSignalContextPills signals={contextSignals} />
        </section>
      )}

      {measurementPaths.length > 0 && (
        <MeasurementPathsSection paths={measurementPaths} />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <section className="flex flex-col gap-6 rounded-xl border border-secondary/25 bg-card/90 p-7">
          <SectionLabel>Run the protocol</SectionLabel>
          <ProtocolShapeDiagram experimentId={experiment.id} />
          {protocol.length > 0 && (
            <ol role="list" className="flex flex-col divide-y divide-border/50">
              {protocol.map((step) => {
                const { lead, rest } = splitBulletLead(step.detail);
                return (
                  <li
                    key={step.number}
                    className="grid grid-cols-[2rem_1fr] gap-x-5 py-3.5 first:pt-0 last:pb-0"
                  >
                    <span
                      aria-hidden="true"
                      className="font-serif text-xl/7 text-primary/70 tabular-nums"
                    >
                      {step.number}
                    </span>
                    <div className="flex flex-col gap-1">
                      {hasSpecificStepTitle(step) ? (
                        <p className="font-serif text-base/6 font-semibold text-foreground">
                          {step.title}
                        </p>
                      ) : null}
                      <p className="text-[15px]/6 text-foreground text-pretty">
                        {lead ? (
                          <>
                            <strong className="font-semibold">{lead}</strong>
                            {rest ? ` ${rest}` : null}
                          </>
                        ) : (
                          step.detail
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="flex flex-col gap-5 rounded-xl border border-secondary/25 bg-card/90 p-7">
          <SectionLabel>Schedule &amp; dose</SectionLabel>

          {(baselineFact || interventionFact) && (
            <ProtocolPhaseTimeline
              baselineDays={experiment.baselineDays}
              totalDays={experiment.durationDays}
              sessionsPerWeek={sessionsPerWeek}
            />
          )}

          {(scheduleEntries.length > 0 || supportingFacts.length > 0) && (
            <dl className="flex flex-col divide-y divide-border/50">
              {scheduleEntries.map((entry) => (
                <div
                  key={entry.label}
                  className="grid items-baseline gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[88px_1fr] sm:gap-4"
                >
                  <dt className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
                    {entry.label}
                  </dt>
                  <dd className="text-sm/5 font-semibold text-foreground">
                    {entry.value}
                  </dd>
                </div>
              ))}
              {supportingFacts.map((fact) => (
                <div
                  key={`${fact.label}-${fact.value}`}
                  className="grid items-baseline gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[88px_1fr] sm:gap-4"
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
        </section>
      </div>

      {protocolTips.length > 0 && (
        <section className="flex flex-col gap-6 rounded-xl border border-secondary/25 bg-card/90 p-7">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <SectionLabel>Good practices</SectionLabel>
            <p className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-muted-foreground">
              To keep results clean
            </p>
          </div>
          <ul
            role="list"
            className={`grid gap-x-10 gap-y-8 ${practiceGridCols(protocolTips.length)}`}
          >
            {protocolTips.map((item, i) => {
              const { lead, rest } = splitBulletLead(item);
              const Icon = PRACTICE_ICONS[i % PRACTICE_ICONS.length];
              return (
                <li key={item} className="flex flex-col gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <p className="text-[15px]/6 text-foreground text-pretty">
                    {lead ? (
                      <>
                        <strong className="font-semibold">{lead}</strong>
                        {rest ? ` ${rest}` : null}
                      </>
                    ) : (
                      item
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="flex items-start gap-2.5 border-t border-border/50 pt-4 text-sm/6 text-muted-foreground">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-serif text-[13px] text-primary"
            >
              ?
            </span>
            <span>
              Anything unclear during the protocol? Ask Murph in the chat,
              it knows the plan, your baseline, and the signals you are
              tracking.
            </span>
          </p>
        </section>
      )}

      {whyItWorksParagraphs.length > 0 && (
        <section className="flex flex-col gap-6 rounded-xl border border-secondary/25 bg-card/90 p-7">
          <SectionLabel>Why it works</SectionLabel>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="flex max-w-3xl flex-col gap-5">
              {whyItWorksParagraphs.map((paragraph, i) => (
                <p
                  key={i}
                  className={
                    i === 0
                      ? "font-serif text-[19px]/7 text-foreground text-pretty"
                      : "text-base/7 text-foreground text-pretty"
                  }
                >
                  {paragraph}
                </p>
              ))}
            </div>
            <MechanismCausalChain experimentId={experiment.id} />
          </div>

          {researchHref && (
            <Link
              href={researchHref}
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Read the research
              <ArrowRight className="size-4" strokeWidth={1.75} />
            </Link>
          )}
        </section>
      )}

      {experts.length > 0 && (
        <div className="flex flex-col gap-3.5">
          <SectionLabel>Recommended by</SectionLabel>
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {experts.map((expert) => (
              <ExpertCard key={expert.name} {...expert} />
            ))}
          </div>
        </div>
      )}

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

function ExpectedSignalContextPills({
  signals,
}: {
  signals: readonly ExperimentSignal[];
}) {
  if (signals.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
      <span className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-muted-foreground">
        Also worth watching
      </span>
      {signals.map((signal) => (
        <span
          key={signal.label}
          className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/35 px-3 py-1.5 text-[12px]/4"
        >
          <span
            aria-hidden="true"
            className="font-serif text-sm/4 text-primary"
          >
            {signalDirectionArrows[signal.direction]}
          </span>
          <span className="font-semibold text-foreground">
            {signal.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function findProtocolFact(
  facts: ProtocolTabExperiment["protocolFacts"],
  label: string,
) {
  return facts.find((fact) => normalizeFactLabel(fact.label) === label);
}

function normalizeFactLabel(label: string): string {
  return label.trim().toLowerCase();
}

function hasSpecificStepTitle(step: ProtocolTabExperiment["protocol"][number]): boolean {
  return step.title.trim() !== `Step ${step.number}`;
}

type CellKind = "baseline" | "session" | "rest" | "empty";

const CELL_CLASS: Record<CellKind, string> = {
  baseline: "bg-secondary",
  session: "bg-primary",
  rest: "bg-primary/10 ring-1 ring-inset ring-primary/25",
  empty: "bg-transparent",
};

const TIMELINE_LEGEND: ReadonlyArray<{
  kind: Exclude<CellKind, "empty">;
  term: string;
  description: string;
}> = [
  { kind: "baseline", term: "Baseline", description: "measurement only, no sessions" },
  { kind: "session", term: "Session", description: "a sauna session that day" },
  { kind: "rest", term: "Rest", description: "no session, still track signals" },
];

function ProtocolPhaseTimeline({
  baselineDays,
  totalDays,
  sessionsPerWeek,
}: {
  baselineDays: number;
  totalDays: number;
  sessionsPerWeek: number;
}) {
  const protocolDays = Math.max(0, totalDays - baselineDays);
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const sessionDayOffsets = [0, 2, 4, 1, 3, 5, 6].slice(0, sessionsPerWeek);
  const sessionTarget = Math.floor(protocolDays / 7) * sessionsPerWeek;
  const cells: CellKind[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dayIndex = w * 7 + d;
      if (dayIndex >= totalDays) {
        cells.push("empty");
      } else if (dayIndex < baselineDays) {
        cells.push("baseline");
      } else {
        const protocolDayInWeek = (dayIndex - baselineDays) % 7;
        cells.push(
          sessionDayOffsets.includes(protocolDayInWeek) ? "session" : "rest",
        );
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={`${baselineDays}-day baseline then ${protocolDays}-day protocol with ${sessionTarget} sessions`}
        className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] items-center gap-x-3 gap-y-1 max-w-[280px]"
      >
        {Array.from({ length: weeks }, (_, w) => {
          const isBaselineRow = cells[w * 7] === "baseline";
          const rowLabel = isBaselineRow ? "Baseline" : `Week ${w}`;
          return (
            <Fragment key={w}>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                {rowLabel}
              </span>
              {Array.from({ length: 7 }, (_, d) => (
                <div
                  key={d}
                  className={`aspect-square rounded-[3px] ${CELL_CLASS[cells[w * 7 + d]]}`}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
      <dl className="flex flex-col gap-2 text-[12px]/4 text-muted-foreground">
        {TIMELINE_LEGEND.map((entry) => (
          <div key={entry.kind} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-[3px] ${CELL_CLASS[entry.kind]}`}
            />
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {entry.term}
            </dt>
            <dd>{entry.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function parseSessionCounts(detail: string): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [];
  for (const piece of detail.split(/[.;]\s*/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/(\d+)\s+session[s]?\s+(\w+)/i);
    if (match) {
      const word = match[2].toLowerCase();
      const label =
        word === "minimum"
          ? "Minimum"
          : word === "target"
            ? "Optimal"
            : word.charAt(0).toUpperCase() + word.slice(1);
      entries.push({ label, value: `${match[1]} sessions` });
    }
  }
  return entries;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-5">
      {children}
    </span>
  );
}

type SegmentKind = "primary" | "secondary" | "muted";

interface ProtocolShape {
  kicker: string;
  formula: ReactNode;
  segments: ReadonlyArray<{ width: number; kind: SegmentKind; label?: string }>;
  labelRow?: ReadonlyArray<{ width: number; text: string; kind: SegmentKind }>;
  ticks: ReadonlyArray<string>;
}

const PROTOCOL_SHAPES: Record<string, ProtocolShape> = {
  "norwegian-4x4": {
    kicker: "One session",
    formula: (
      <>
        10′<span className="text-muted-foreground"> warm-up </span>
        <span className="text-chart-5">+</span>{" "}
        <span className="text-primary">4 × (4′ hard / 3′ easy)</span>{" "}
        <span className="text-chart-5">+</span> 5′
        <span className="text-muted-foreground"> cool-down </span>
        <span className="text-chart-5">=</span>{" "}
        <span className="tabular-nums">48 min</span>
      </>
    ),
    segments: [
      { width: 10, kind: "muted" },
      { width: 4, kind: "primary" },
      { width: 3, kind: "secondary" },
      { width: 4, kind: "primary" },
      { width: 3, kind: "secondary" },
      { width: 4, kind: "primary" },
      { width: 3, kind: "secondary" },
      { width: 4, kind: "primary" },
      { width: 5, kind: "muted" },
    ],
    labelRow: [
      { width: 10, text: "warm-up", kind: "muted" },
      { width: 25, text: "4 × hard / easy", kind: "primary" },
      { width: 5, text: "cool-down", kind: "muted" },
    ],
    ticks: ["0", "10 min", "35 min", "40 min"],
  },
  "finnish-sauna": {
    kicker: "One session",
    formula: (
      <>
        2′<span className="text-muted-foreground"> settle </span>
        <span className="text-chart-5">+</span>{" "}
        <span className="text-primary">15–20′ at 80–100 °C</span>{" "}
        <span className="text-chart-5">+</span> 3′
        <span className="text-muted-foreground"> cool-down</span>
      </>
    ),
    segments: [
      { width: 2, kind: "muted" },
      { width: 18, kind: "primary" },
      { width: 3, kind: "muted" },
    ],
    labelRow: [
      { width: 2, text: "settle", kind: "muted" },
      { width: 18, text: "sauna 80–100 °C", kind: "primary" },
      { width: 3, text: "cool-down", kind: "muted" },
    ],
    ticks: ["0", "2 min", "20 min", "23 min"],
  },
  "bryan-johnson-blueprint": {
    kicker: "Per day",
    formula: (
      <>
        <span className="text-muted-foreground">morning workout </span>
        <span className="text-chart-5">→</span>{" "}
        <span className="text-primary">20′ at 93 °C</span>{" "}
        <span className="text-chart-5">→</span>{" "}
        <span className="text-muted-foreground">rehydrate</span>
      </>
    ),
    segments: [
      { width: 30, kind: "secondary" },
      { width: 20, kind: "primary" },
      { width: 10, kind: "muted" },
    ],
    labelRow: [
      { width: 30, text: "workout", kind: "secondary" },
      { width: 20, text: "sauna 93 °C", kind: "primary" },
      { width: 10, text: "rehydrate", kind: "muted" },
    ],
    ticks: ["start", "after workout", "end"],
  },
  "red-light-glasses-before-bed": {
    kicker: "Evening window",
    formula: (
      <>
        <span className="text-primary">90–120′ with glasses</span>{" "}
        <span className="text-chart-5">→</span>{" "}
        <span className="text-muted-foreground">remove </span>
        <span className="text-chart-5">→</span>{" "}
        <span className="tabular-nums">bedtime</span>
      </>
    ),
    segments: [
      { width: 120, kind: "primary" },
      { width: 5, kind: "muted" },
    ],
    labelRow: [
      { width: 120, text: "glasses on", kind: "primary" },
      { width: 5, text: "bedtime", kind: "muted" },
    ],
    ticks: ["−120 min", "bedtime"],
  },
};

function ProtocolShapeDiagram({ experimentId }: { experimentId: string }) {
  const shape = PROTOCOL_SHAPES[experimentId];
  if (!shape) return null;
  return (
    <ProtocolShapeRail
      segments={shape.segments}
      labelRow={shape.labelRow}
      ticks={shape.ticks}
    />
  );
}

function ProtocolShapeRail({
  segments,
  labelRow,
  ticks,
}: {
  segments: ReadonlyArray<{ width: number; kind: SegmentKind; label?: string }>;
  labelRow?: ReadonlyArray<{ width: number; text: string; kind: SegmentKind }>;
  ticks: ReadonlyArray<string>;
}) {
  const total = segments.reduce((sum, s) => sum + s.width, 0);
  const effectiveLabels =
    labelRow ??
    (segments.some((s) => s.label)
      ? segments.map((s) => ({
          width: s.width,
          text: s.label ?? "",
          kind: s.kind,
        }))
      : undefined);
  const labelTotal = effectiveLabels?.reduce((sum, l) => sum + l.width, 0) ?? 0;

  return (
    <div className="flex flex-col gap-1.5">
      {effectiveLabels && labelTotal > 0 && (
        <div className="hidden gap-px sm:flex">
          {effectiveLabels.map((entry, i) => {
            const color =
              entry.kind === "primary"
                ? "text-primary"
                : "text-muted-foreground";
            return (
              <p
                key={i}
                className={`truncate text-center font-mono text-[10px] uppercase tracking-[0.08em] ${color}`}
                style={{ width: `${(entry.width / labelTotal) * 100}%` }}
              >
                {entry.text}
              </p>
            );
          })}
        </div>
      )}
      <div className="flex h-3.5">
        {segments.map((segment, i) => {
          const cls =
            segment.kind === "primary"
              ? "bg-primary"
              : segment.kind === "secondary"
                ? "bg-primary/30"
                : "bg-secondary";
          return (
            <div
              key={i}
              className={`${cls} mr-px last:mr-0`}
              style={{ width: `${(segment.width / total) * 100}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[9px]/3 tabular-nums text-muted-foreground">
        {ticks.map((tick, i) => (
          <span key={i}>{tick}</span>
        ))}
      </div>
      {effectiveLabels && labelTotal > 0 && (
        <ul role="list" className="mt-2 flex flex-wrap gap-x-3 gap-y-1 sm:hidden">
          {effectiveLabels
            .filter((entry) => entry.text)
            .map((entry, i) => {
              const dotCls =
                entry.kind === "primary"
                  ? "bg-primary"
                  : entry.kind === "secondary"
                    ? "bg-primary/30"
                    : "bg-secondary";
              return (
                <li
                  key={i}
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
                >
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${dotCls}`} />
                  <span>{entry.text}</span>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

const CAUSAL_CHAINS: Record<string, ReadonlyArray<{ label: string; content: string }>> = {
  "norwegian-4x4": [
    { label: "Session", content: "4 × (4′ hard · 3′ easy)" },
    { label: "Acute physiology", content: "HR 85–95% HRmax · sustained aerobic stress" },
    { label: "Adaptation", content: "stroke volume · capillaries · mitochondria" },
    { label: "Outcome", content: "VO₂max ↑ · resting HR ↓" },
  ],
  "finnish-sauna": [
    { label: "Session", content: "80–100 °C dry sauna · ~15–20 min · 3×/week" },
    { label: "Acute physiology", content: "skin vessels dilate · sweat · HR ↑ · core temp climbs" },
    { label: "Adaptation", content: "plasma volume ↑ · earlier sweating · HSP-70 · endothelial tone" },
    { label: "Outcome", content: "resting HR ↓ · calmer post-sauna downshift" },
  ],
  "bryan-johnson-blueprint": [
    { label: "Session", content: "93 °C dry sauna · daily · post-workout · groin ice" },
    { label: "Acute physiology", content: "heat + exercise residue stack · sustained core-temp rise" },
    { label: "Adaptation", content: "heat acclimation · plasma volume ↑ · less HR strain per dose" },
    { label: "Outcome", content: "heat tolerance ↑ · fertility guardrail (groin cooling required)" },
  ],
  "red-light-glasses-before-bed": [
    { label: "Session", content: "amber/red glasses · last 90–120 min before bed" },
    { label: "Acute physiology", content: "melanopic retinal signal ↓ · alerting eases" },
    { label: "Adaptation", content: "melatonin unsuppressed · core temp trends down" },
    { label: "Outcome", content: "shorter sleep onset · less pre-bed wiredness" },
  ],
};

function MechanismCausalChain({ experimentId }: { experimentId: string }) {
  const steps = CAUSAL_CHAINS[experimentId];
  if (!steps) {
    return null;
  }
  return (
    <div className="flex flex-col gap-5">
      <SectionLabel>How the body adapts</SectionLabel>
      <ol role="list" className="flex flex-col gap-7">
        {steps.map((step, i) => (
          <li
            key={step.label}
            className="relative grid grid-cols-[auto_1fr] gap-x-5"
          >
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[13px] top-8 -bottom-7 w-px bg-primary/25"
              />
            )}
            <span
              aria-hidden="true"
              className="relative z-[1] inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-background font-mono text-[11px] font-semibold text-primary tabular-nums"
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-1.5 pt-0.5">
              <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
                {step.label}
              </span>
              <p className="font-serif text-[15px]/6 text-foreground text-pretty">
                {step.content}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MeasurementPathsSection({
  paths,
}: {
  paths: readonly ExperimentMeasurementPath[];
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex max-w-3xl flex-col gap-1.5">
        <SectionLabel>Measurement paths</SectionLabel>
        <h2 className="font-serif text-2xl/8 font-semibold text-foreground">
          How this can be measured
        </h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {paths.map((path) => (
          <MeasurementPathCard key={path.pathId} path={path} />
        ))}
      </div>
    </section>
  );
}

function MeasurementPathCard({ path }: { path: ExperimentMeasurementPath }) {
  const privacyNotes = getMeasurementPathPrivacyNotes(path);

  return (
    <article className="flex min-h-full flex-col gap-4 rounded-xl border border-secondary/25 bg-card/90 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
            {formatMeasurementTierLabel(path.tier)}
          </span>
          <h3 className="text-sm/5 font-semibold text-foreground">
            {path.label}
          </h3>
        </div>
        <span className="shrink-0 rounded-full border border-border/70 bg-background/50 px-2.5 py-1 font-mono text-[10px]/3 uppercase tracking-[0.08em] text-muted-foreground">
          {formatMeasurementPathBadge(path)}
        </span>
      </div>

      {path.outcomeLabels.length > 0 && (
        <p className="text-[13px]/5 text-muted-foreground">
          Measures {formatList(path.outcomeLabels)}.
        </p>
      )}

      {path.methods.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
            Method
          </span>
          <div className="flex flex-col gap-2">
            {path.methods.map((method) => (
              <div key={method.key} className="flex flex-col gap-1">
                {method.href ? (
                  <Link
                    href={method.href}
                    className="text-[13px]/5 font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    {method.shortName}
                  </Link>
                ) : (
                  <span className="text-[13px]/5 font-semibold text-foreground">
                    {method.shortName}
                  </span>
                )}
                {method.modalities.length > 0 && (
                  <span className="text-xs/4 text-muted-foreground">
                    {formatList(method.modalities)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {path.safetyOutcomeLabels.length > 0 && (
        <p className="text-xs/4 text-muted-foreground">
          Safety context: {formatList(path.safetyOutcomeLabels)}.
        </p>
      )}

      {privacyNotes.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-background/35 p-3">
          <span className="font-mono text-[10px]/3 uppercase tracking-[0.08em] text-chart-5">
            Photo privacy
          </span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {privacyNotes.map((note) => (
              <li key={note} className="text-xs/4 text-muted-foreground">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {path.notes.length > 0 && (
        <ul className="mt-auto flex flex-col gap-2 border-t border-border/60 pt-3">
          {path.notes.slice(0, 2).map((note) => (
            <li key={note} className="flex gap-2 text-xs/4 text-muted-foreground">
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-secondary"
              />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function getMeasurementPathPrivacyNotes(path: ExperimentMeasurementPath): string[] {
  const hasIdentifiableImages = path.methods.some((method) =>
    method.privacy?.containsIdentifiableImages
  );
  const localOnlyRecommended = path.methods.some((method) =>
    method.privacy?.localOnlyRecommended
  );
  return uniqueStrings([
    hasIdentifiableImages ? "May include identifiable face or skin images." : null,
    localOnlyRecommended
      ? "Keep originals local and private unless you intentionally import or share them."
      : null,
    ...path.methods.flatMap((method) => method.privacy?.notes ?? []),
  ]).slice(0, 4);
}

function formatMeasurementTierLabel(
  tier: ExperimentMeasurementPath["tier"],
): string {
  switch (tier) {
    case "default_home":
      return "Default home";
    case "optional_home":
      return "Optional home";
    case "consumer_device":
      return "Consumer device";
    case "clinic":
      return "Clinic upgrade";
    case "research":
      return "Research";
    case "reference":
      return "Reference";
  }
}

function formatMeasurementPathBadge(path: ExperimentMeasurementPath): string {
  if (path.isDefault) {
    return "Default";
  }

  return path.required ? "Required" : "Optional";
}

function formatList(values: readonly string[]): string {
  if (values.length <= 2) {
    return values.join(" and ");
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
