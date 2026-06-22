import Image from "next/image";
import Link from "next/link";

import type {
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-projections";
import { cn } from "@/src/lib/utils";
import { biomarkerFitDisplayLabel, biomarkerFitToneClassName } from "./biomarker-fit-tone";

const HERO_IMAGE_SIZES = "(min-width: 1024px) 320px, 100vw";

export function BiomarkerExperimentCardHero({
  protocol,
}: {
  protocol: BiomarkerProtocolRankingModel;
}) {
  const imageSrc = protocol.image;
  const directionArrow = directionArrowFor(protocol.expectedDirection);

  const expectedHighlight = `${directionArrow} ${protocol.expectedSignalLabel}`;
  const durationHighlight = protocol.durationLabel;
  const evidenceLabel = `${protocol.evidenceLabel} evidence`;

  return (
    <Link
      href={protocol.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/90 transition-colors hover:border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 lg:flex-row"
    >
      <div className="relative aspect-[2/1] w-full shrink-0 overflow-hidden outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10 sm:aspect-[16/9] lg:aspect-auto lg:w-[320px] lg:self-stretch">
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
      </div>

      <div className="flex flex-1 flex-col gap-5 p-6 lg:p-7">
        <div className="flex items-start justify-between gap-4 sm:gap-6">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-chart-5">
              {protocol.category}
            </span>
            <h3 className="font-serif text-xl/tight font-semibold tracking-tight text-foreground text-balance sm:text-2xl/tight lg:text-[26px]">
              {protocol.title}
            </h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span
              className={cn(
                "font-serif text-lg/6 font-semibold sm:text-2xl/8",
                biomarkerFitToneClassName(protocol.fitLabel),
              )}
            >
              {biomarkerFitDisplayLabel(protocol.fitLabel)}
            </span>
            <span className="font-mono text-[9px]/3 uppercase tracking-[0.14em] text-muted-foreground">
              fit
            </span>
          </div>
        </div>

        <p className="max-w-[68ch] text-sm/6 text-muted-foreground text-pretty sm:text-[15px]/7">
          {protocol.mechanism}
        </p>

        <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-5 sm:gap-x-6 sm:grid-cols-4">
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
          "font-serif text-sm/5 font-semibold tabular-nums text-foreground text-pretty sm:text-base/6",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
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
