import type { ReactNode } from "react";

import { StartExperimentButton } from "@/src/components/experiments/experiment-detail/start-experiment-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/src/components/ui/tooltip";
import type { ExperimentStartContactChannels } from "@/src/lib/experiments/start-experiment-contact";
import type { ExperimentStatus } from "@/src/types/experiments";

interface ExperimentHeaderProps {
  title: string;
  category: string;
  durationDays: number;
  evidenceLevel: number;
  matchPercent?: number;
  status: ExperimentStatus;
  day?: number;
  dateRange?: string;
  baselineDays: number;
  completionPercent?: number;
  description?: string;
  initialContactChannels?: Partial<ExperimentStartContactChannels> | null;
  murphPhoneNumber?: string | null;
  showStartAction?: boolean;
  startAction?: ReactNode;
}

export function ExperimentHeader({
  title,
  category,
  durationDays,
  evidenceLevel,
  matchPercent,
  status,
  day,
  dateRange,
  baselineDays,
  completionPercent,
  description,
  initialContactChannels,
  murphPhoneNumber,
  showStartAction = true,
  startAction,
}: ExperimentHeaderProps) {
  const isActive = status === "active";
  const isPaused = status === "paused";
  const isFinished = status === "finished";
  const isStopped = status === "stopped";
  const inBaseline = baselineDays > 0 && day != null && day <= baselineDays;
  const protocolDays = formatProtocolDays(durationDays, baselineDays);
  const protocolDay = day == null ? null : Math.max(1, day - baselineDays);
  const renderedDescription = description
    ? normalizeExperimentHeaderDescription(description)
    : null;

  return (
    <div className="relative z-10 flex flex-col gap-7">
      <div className="flex flex-col items-stretch gap-6 md:flex-row md:items-start md:justify-between md:gap-10">
        <div className="flex max-w-[700px] flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="shrink-0 font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-5">
              {category.toUpperCase()}
            </span>
            <span className="shrink-0 text-[11px]/3.5 text-secondary">·</span>
            <span className="shrink-0 font-mono text-[11px]/3.5 text-chart-5">
              {protocolDays} DAYS
            </span>
            <span className="shrink-0 text-[11px]/3.5 text-secondary">·</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="flex gap-[3px]">
                  {Array.from({ length: evidenceLevel }, (_, i) => (
                    <div key={i} className="size-1.5 shrink-0 rounded-full bg-ring" />
                  ))}
                </TooltipTrigger>
                <TooltipContent>Evidence level {evidenceLevel} of 5</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {matchPercent && (
              <>
                <span className="shrink-0 text-[11px]/3.5 text-secondary">·</span>
                <span className="rounded-[10px] bg-primary/10 px-2 py-0.5 text-[9px]/3 text-foreground">
                  {matchPercent}% match
                </span>
              </>
            )}
            {isActive && (
              <>
                <span className="shrink-0 text-[11px]/3.5 text-secondary">·</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px]/3.5 tabular-nums text-chart-5">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  {day
                    ? inBaseline
                      ? `Baseline day ${day} of ${baselineDays}`
                      : `Day ${protocolDay} of ${protocolDays}`
                    : "Active run"}
                </span>
              </>
            )}
            {isPaused && (
              <>
                <span className="shrink-0 text-[11px]/3.5 text-secondary">·</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px]/3.5 tabular-nums text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                  {day
                    ? inBaseline
                      ? `Paused during baseline day ${day} of ${baselineDays}`
                      : `Paused on day ${protocolDay} of ${protocolDays}`
                    : "Paused"}
                </span>
              </>
            )}
            {isFinished && (
              <>
                <span className="shrink-0 text-[11px]/3.5 text-secondary">·</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px]/3.5 tabular-nums text-ring">
                  <span className="size-1.5 rounded-full bg-ring" />
                  {dateRange ?? "Finished"}
                </span>
              </>
            )}
            {isStopped && (
              <>
                <span className="shrink-0 text-[11px]/3.5 text-secondary">·</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px]/3.5 tabular-nums text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                  {dateRange ?? "Stopped"}
                </span>
              </>
            )}
          </div>

          <h1 className="font-serif text-3xl font-semibold leading-[110%] tracking-[-0.03em] text-balance text-foreground sm:text-[38px]">
            {title}
          </h1>

          {renderedDescription && (
            <p className="text-[16px] leading-[160%] text-muted-foreground">
              {renderedDescription}
            </p>
          )}
        </div>

        {status === "upcoming" && showStartAction && (
          startAction ?? (
            <StartExperimentButton
              initialContactChannels={initialContactChannels}
              murphPhoneNumber={murphPhoneNumber}
              protocolDays={protocolDays}
              protocolTitle={title}
            />
          )
        )}

        {isActive && completionPercent != null && (
          <div className="relative flex size-16 shrink-0 items-center justify-center">
            <svg viewBox="0 0 36 36" className="size-16 -rotate-90">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#D4C4A8"
                strokeWidth="2.5"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#5A6E32"
                strokeWidth="2.5"
                strokeDasharray={`${completionPercent}, 100`}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {completionPercent}%
              </span>
              <span className="text-[8px] text-ring">complete</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatProtocolDays(durationDays: number, baselineDays: number): number {
  return Math.max(1, durationDays - baselineDays);
}

function normalizeExperimentHeaderDescription(description: string): string {
  return description.replace(
    /\s+best read as personal context rather than expected outcomes\.$/u,
    ".",
  );
}
