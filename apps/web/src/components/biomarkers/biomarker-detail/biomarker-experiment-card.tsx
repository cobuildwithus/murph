import Image from "next/image";
import Link from "next/link";

import type {
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-projections";
import { resolveHealthCommonsExperimentShell } from "@/src/lib/health-commons/experiment-projections";
import { cn } from "@/src/lib/utils";
import { biomarkerFitToneClassName } from "./biomarker-fit-tone";

const CARD_IMAGE_SIZES = "(min-width: 1024px) 33vw, 100vw";

export function BiomarkerExperimentCard({
  protocol,
}: {
  protocol: BiomarkerProtocolRankingModel;
}) {
  const experimentId = extractExperimentSlug(protocol.href);
  const shell = experimentId ? resolveHealthCommonsExperimentShell(experimentId) : null;
  const imageSrc = shell?.image ?? null;
  const directionArrow = directionArrowFor(protocol.expectedDirection);

  const expectedHighlight = `${directionArrow} ${protocol.expectedSignalLabel}`;
  const durationHighlight = protocol.durationLabel;

  const evidenceLabel = `${protocol.evidenceLabel} evidence`;
  const cautionLabel = `Caution ${protocol.cautionLabel.toLowerCase()}`;

  return (
    <Link
      href={protocol.href}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card/90 transition-colors hover:border-border"
    >
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt=""
            fill
            sizes={CARD_IMAGE_SIZES}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/40">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {protocol.category}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
              {protocol.category}
            </span>
            <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground text-balance">
              {protocol.title}
            </h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span
              className={cn(
                "font-serif text-xl/6 font-semibold",
                biomarkerFitToneClassName(protocol.fitLabel),
              )}
            >
              {protocol.fitLabel}
            </span>
            <span className="font-mono text-[9px]/3 uppercase tracking-[0.14em] text-muted-foreground">
              fit
            </span>
          </div>
        </div>
        <p className="text-sm/5.5 text-muted-foreground text-pretty line-clamp-3">{protocol.mechanism}</p>
      </div>

      <div className="mt-auto grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 bg-muted/30">
        <StatCell
          label="Exp. change"
          value={expectedHighlight}
          valueClassName="font-serif text-sm/5 font-semibold text-primary"
        />
        <StatCell
          label="Duration"
          value={durationHighlight}
          valueClassName="font-serif text-sm/5 font-semibold text-foreground"
        />
        <StatCell
          label="Burden"
          value={formatChipLabel(protocol.burdenLabel)}
          valueClassName="text-sm/5 font-medium text-foreground"
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
    <div className="flex flex-col gap-1.5 px-4 py-4 min-w-0">
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

function formatChipLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
