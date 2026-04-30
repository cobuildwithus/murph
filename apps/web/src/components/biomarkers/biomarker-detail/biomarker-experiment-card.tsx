import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  resolveBiomarkerExperimentSignal,
  type BiomarkerExperimentSignalEstimate,
} from "@/src/lib/biomarkers/biomarker-experiment-signals";
import type {
  BiomarkerPageModel,
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-detail";
import { resolveHealthCommonsExperimentShell } from "@/src/lib/health-commons/experiment-projections";

const CARD_IMAGE_SIZES = "(min-width: 1024px) 200px, (min-width: 640px) 180px, 100vw";

export function BiomarkerExperimentCard({
  biomarker,
  protocol,
}: {
  biomarker: BiomarkerPageModel;
  protocol: BiomarkerProtocolRankingModel;
}) {
  const experimentId = extractExperimentSlug(protocol.href);
  const shell = experimentId ? resolveHealthCommonsExperimentShell(experimentId) : null;
  const image = shell?.image ?? null;
  const signal = experimentId
    ? resolveBiomarkerExperimentSignal(experimentId, biomarker.routeId)
    : null;
  const directionArrow = directionArrowFor(protocol.expectedDirection);
  const directionLabel = formatExpectedDirection(protocol.expectedDirection);
  const matchPercent = computeMatchPercent(protocol.scoring);

  return (
    <Link
      href={protocol.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/90 transition-colors hover:border-border"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row">
        <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-lg sm:h-[110px] sm:w-[195px]">
          {image ? (
            <Image
              src={image}
              alt=""
              fill
              sizes={CARD_IMAGE_SIZES}
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted/40">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {protocol.category}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
                {protocol.category}
              </span>
              <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {protocol.title}
              </h3>
            </div>
            <MatchBadge percent={matchPercent} />
          </div>
          <p className="text-sm/5.5 text-muted-foreground text-pretty">{protocol.mechanism}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-5 py-3.5">
        <SignalLine
          arrow={directionArrow}
          label={directionLabel}
          signal={signal}
          biomarkerShortName={biomarker.shortName}
        />
        <MetaRow protocol={protocol} signal={signal} />
      </div>
    </Link>
  );
}

function MatchBadge({ percent }: { percent: number | null }) {
  if (percent == null) return null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      <span className="font-serif text-2xl/6 font-semibold tabular-nums text-primary">
        {percent}%
      </span>
      <span className="font-mono text-[9px]/3 uppercase tracking-[0.14em] text-muted-foreground">
        match
      </span>
    </div>
  );
}

function SignalLine({
  arrow,
  label,
  signal,
  biomarkerShortName,
}: {
  arrow: string;
  label: string;
  signal: BiomarkerExperimentSignalEstimate | null;
  biomarkerShortName: string;
}) {
  if (signal) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-serif text-lg font-semibold tracking-tight text-primary">
          <span aria-hidden="true">{arrow}</span> {signal.range} {biomarkerShortName}
        </span>
        <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.1em] text-muted-foreground">
          over {signal.window}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-serif text-base font-semibold text-primary">
        <span aria-hidden="true">{arrow}</span> {label} {biomarkerShortName}
      </span>
    </div>
  );
}

function MetaRow({
  protocol,
  signal,
}: {
  protocol: BiomarkerProtocolRankingModel;
  signal: BiomarkerExperimentSignalEstimate | null;
}) {
  const evidenceLabel = signal?.evidence
    ? `${signal.evidence} evidence`
    : `${formatChipLabel(protocol.confidence)} evidence`;

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]/3 uppercase tracking-[0.1em] text-muted-foreground">
      <MetaPart>{evidenceLabel}</MetaPart>
      <MetaSeparator />
      <MetaPart>burden {protocol.burdenLabel.toLowerCase()}</MetaPart>
      <MetaSeparator />
      <MetaPart>caution {protocol.cautionLabel.toLowerCase()}</MetaPart>
    </p>
  );
}

function MetaPart({ children }: { children: ReactNode }) {
  return <span>{children}</span>;
}

function MetaSeparator() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/50">
      ·
    </span>
  );
}

// Derives a 0–100 "match" percent from the positive scoring dimensions
// (evidence × biomarker relevance × wearable measurability). Burden and
// caution are surfaced separately so users can read commitment + risk
// independently of the fit score.
//
// TEMPORARY: rocketman-21 will replace this with a real per-user match
// score once user-baseline integration lands. Until then this is the best
// "fit for this biomarker" signal we have. Tracked in TODOS.md.
function computeMatchPercent(
  scoring: BiomarkerProtocolRankingModel["scoring"],
): number | null {
  const positive =
    scoring.evidenceWeight + scoring.biomarkerRelevance + scoring.wearableMeasurability;
  // 3 dimensions × max 5 each = 15
  const ratio = Math.max(0, Math.min(1, positive / 15));
  return Math.round(ratio * 100);
}

function extractExperimentSlug(href: string): string | null {
  const match = href.match(/\/experiments\/([^/?#]+)/u);
  return match ? match[1] : null;
}

function directionArrowFor(direction: BiomarkerProtocolRankingModel["expectedDirection"]): string {
  switch (direction) {
    case "down":
    case "down_or_stable":
      return "↓";
    case "up":
    case "up_or_stable":
      return "↑";
    case "stable":
      return "→";
    default:
      return "·";
  }
}

function formatExpectedDirection(value: BiomarkerProtocolRankingModel["expectedDirection"]): string {
  switch (value) {
    case "down":
      return "Expected lower";
    case "down_or_stable":
      return "Lower or stable";
    case "up":
      return "Expected higher";
    case "up_or_stable":
      return "Higher or stable";
    case "stable":
      return "Expected stable";
    case "mixed_or_contextual":
      return "Contextual";
    default: {
      const _exhaustive: never = value;
      return formatChipLabel(String(_exhaustive));
    }
  }
}

function formatChipLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
