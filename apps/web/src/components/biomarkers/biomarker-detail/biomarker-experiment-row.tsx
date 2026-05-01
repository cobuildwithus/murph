import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type {
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-projections";
import { cn } from "@/src/lib/utils";
import { biomarkerFitToneClassName } from "./biomarker-fit-tone";

const ROW_GRID =
  "grid-cols-[40px_minmax(0,1fr)_max-content] md:grid-cols-[40px_minmax(0,1fr)_120px_88px_88px_96px_64px_20px]";

export function BiomarkerExperimentRowHeader() {
  return (
    <div
      className={`grid ${ROW_GRID} gap-x-6 bg-muted/30 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground`}
    >
      <span aria-hidden="true" />
      <span>Experiment</span>
      <span className="hidden md:inline">Exp. change</span>
      <span className="hidden md:inline">Duration</span>
      <span className="hidden md:inline">Burden</span>
      <span className="hidden md:inline">Evidence</span>
      <span className="justify-self-end whitespace-nowrap text-right md:justify-self-auto md:text-left">
        Fit
      </span>
      <span aria-hidden="true" className="hidden md:inline" />
    </div>
  );
}

export function BiomarkerExperimentRow({
  protocol,
}: {
  protocol: BiomarkerProtocolRankingModel;
}) {
  const imageSrc = protocol.image;
  const directionArrow = directionArrowFor(protocol.expectedDirection);
  const expectedShort = protocol.expectedSignalLabel;
  const durationShort = protocol.durationLabel;
  const burdenShort = formatChipLabel(protocol.burdenLabel);
  const evidenceShort = protocol.evidenceLabel;

  return (
    <Link
      href={protocol.href}
      className={`group grid ${ROW_GRID} items-center gap-x-6 px-5 py-4 transition-colors hover:bg-muted/30`}
    >
      <div className="relative size-10 shrink-0 overflow-hidden rounded-md">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt=""
            fill
            sizes="40px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.05]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/50">
            <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground">
              {protocol.category.slice(0, 3)}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="font-serif text-base font-medium text-foreground truncate">
          {protocol.title}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {protocol.category}
        </span>
      </div>
      <span className="hidden font-serif text-sm font-medium text-primary tabular-nums md:inline">
        {directionArrow} {expectedShort}
      </span>
      <span className="hidden text-sm text-foreground tabular-nums md:inline">
        {durationShort}
      </span>
      <span className="hidden text-sm text-foreground md:inline">
        {burdenShort}
      </span>
      <span className="hidden text-sm text-foreground md:inline">
        {evidenceShort}
      </span>
      <span
        className={cn(
          "justify-self-end whitespace-nowrap text-right font-serif text-base font-semibold md:justify-self-auto md:text-left",
          biomarkerFitToneClassName(protocol.fitLabel),
        )}
      >
        {protocol.fitLabel}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="hidden size-4 text-muted-foreground/60 transition-colors group-hover:text-foreground md:inline"
        strokeWidth={1.75}
      />
    </Link>
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
