import Image from "next/image";
import Link from "next/link";

import { resolveBiomarkerExperimentSignal } from "@/src/lib/biomarkers/biomarker-experiment-signals";
import type {
  BiomarkerPageModel,
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-detail";
import { resolveHealthCommonsExperimentShell } from "@/src/lib/health-commons/experiment-projections";
import { cn } from "@/src/lib/utils";

const HERO_IMAGE_SIZES = "(min-width: 1024px) 320px, 100vw";

export function BiomarkerExperimentCardHero({
  biomarker,
  protocol,
}: {
  biomarker: BiomarkerPageModel;
  protocol: BiomarkerProtocolRankingModel;
}) {
  const experimentId = extractExperimentSlug(protocol.href);
  const shell = experimentId ? resolveHealthCommonsExperimentShell(experimentId) : null;
  const imageSrc = shell?.image ?? null;
  const signal = experimentId
    ? resolveBiomarkerExperimentSignal(experimentId, biomarker.routeId)
    : null;
  const matchPercent = computeMatchPercent(protocol.scoring);
  const directionArrow = directionArrowFor(protocol.expectedDirection);
  const directionLabel = formatExpectedDirection(protocol.expectedDirection);

  const expectedHighlight = signal
    ? `${directionArrow} ${signal.range}`
    : `${directionArrow} ${directionLabel}`;
  const durationHighlight = signal?.window ?? "—";
  const evidenceLabel = signal?.evidence
    ? `${formatChipLabel(signal.evidence)} evidence`
    : `${formatChipLabel(protocol.confidence)} evidence`;

  return (
    <Link
      href={protocol.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/90 transition-colors hover:border-border lg:flex-row"
    >
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden lg:aspect-auto lg:w-[320px] lg:self-stretch">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt=""
            fill
            sizes={HERO_IMAGE_SIZES}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/40">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {protocol.category}
            </span>
          </div>
        )}
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-foreground/90 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-background backdrop-blur-sm">
          Recommended for you
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-5 p-6 lg:p-7">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
              {protocol.category}
            </span>
            <h3 className="font-serif text-2xl/tight font-semibold tracking-tight text-foreground text-balance sm:text-[26px]">
              {protocol.title}
            </h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-serif text-3xl/8 font-semibold tabular-nums text-primary">
              {matchPercent}%
            </span>
            <span className="font-mono text-[9px]/3 uppercase tracking-[0.14em] text-muted-foreground">
              match
            </span>
          </div>
        </div>

        <p className="max-w-[68ch] text-[15px]/7 text-muted-foreground text-pretty">
          {protocol.mechanism}
        </p>

        <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border/60 pt-5 sm:grid-cols-4">
          <Stat label="Exp. change" value={expectedHighlight} valueClassName="text-primary" />
          <Stat label="Duration" value={durationHighlight} />
          <Stat label="Burden" value={formatChipLabel(protocol.burdenLabel)} />
          <Stat label="Evidence" value={evidenceLabel.replace(" evidence", "")} />
        </div>
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="font-mono text-[10px]/3 uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-serif text-base/6 font-semibold text-foreground text-pretty",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function computeMatchPercent(
  scoring: BiomarkerProtocolRankingModel["scoring"],
): number {
  const positive =
    scoring.evidenceWeight + scoring.biomarkerRelevance + scoring.wearableMeasurability;
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
    case "down_or_stable":
      return "lower";
    case "up":
    case "up_or_stable":
      return "higher";
    case "stable":
      return "stable";
    case "mixed_or_contextual":
      return "varied";
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
