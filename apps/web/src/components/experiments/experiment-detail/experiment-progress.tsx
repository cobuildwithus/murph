import { Progress } from "@/src/components/ui/progress";

interface ExperimentProgressProps {
  baselineDays: number;
  baselineComplete: boolean;
  activeDay: number;
  activeTotalDays: number;
  overallPercent: number;
}

export function ExperimentProgress({
  baselineDays,
  baselineComplete,
  activeDay,
  activeTotalDays,
  overallPercent,
}: ExperimentProgressProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-primary">
          Baseline · {baselineDays}d {baselineComplete ? "✓" : ""}
        </span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-widest">
          Active · Day {activeDay} of {activeTotalDays}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Analysis
        </span>
      </div>
      <Progress value={overallPercent} className="h-1.5" />
    </div>
  );
}
