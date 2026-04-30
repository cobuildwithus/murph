import Image from "next/image";
import Link from "next/link";

import { resolveBiomarkerExperimentSignal } from "@/src/lib/biomarkers/biomarker-experiment-signals";
import type {
  BiomarkerPageModel,
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-detail";
import { resolveHealthCommonsExperimentShell } from "@/src/lib/health-commons/experiment-projections";
import { cn } from "@/src/lib/utils";

const CARD_IMAGE_SIZES = "(min-width: 640px) 160px, 100vw";

export function BiomarkerExperimentCard({
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
  const cautionLabel = `Caution ${protocol.cautionLabel.toLowerCase()}`;

  return (
    <Link
      href={protocol.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/90 transition-colors hover:border-border"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row">
        <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden rounded-lg sm:h-[90px] sm:w-[160px]">
          {imageSrc ? (
            <Image
              src={imageSrc}
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
        <div className="flex flex-1 items-start justify-between gap-4 min-w-0">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
                {protocol.category}
              </span>
              <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground text-balance">
                {protocol.title}
              </h3>
            </div>
            <p className="text-sm/5.5 text-muted-foreground text-pretty">{protocol.mechanism}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-serif text-2xl/6 font-semibold tabular-nums text-primary">
              {matchPercent}%
            </span>
            <span className="font-mono text-[9px]/3 uppercase tracking-[0.14em] text-muted-foreground">
              match
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 bg-muted/30">
        <StatCell
          label="Expected change"
          value={expectedHighlight}
          valueClassName="font-serif text-base/6 font-semibold text-primary"
        />
        <StatCell
          label="Duration"
          value={durationHighlight}
          valueClassName="font-serif text-base/6 font-semibold text-foreground"
        />
        <StatCell
          label="Burden"
          value={formatChipLabel(protocol.burdenLabel)}
          valueClassName="text-base/6 font-medium text-foreground"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-3">
        <Pill>{evidenceLabel}</Pill>
        <Pill>{cautionLabel}</Pill>
      </div>
    </Link>
  );
}

function StatCell({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 min-w-0">
      <span className="font-mono text-[10px]/3 uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-pretty", valueClassName)}>{value}</span>
    </div>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-background/40 px-2.5 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

// TEMPORARY heuristic: rocketman-21 will replace with a real per-user
// match score once user-baseline integration lands. Tracked in TODOS.md.
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
