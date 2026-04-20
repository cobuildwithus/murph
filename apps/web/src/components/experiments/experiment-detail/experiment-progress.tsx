import { Progress } from "@/src/components/ui/progress";

interface ExperimentProgressProps {
  baselineLabel: string;
  protocolLabel: string;
  overallPercent: number;
}

export function ExperimentProgress({
  baselineLabel,
  protocolLabel,
  overallPercent,
}: ExperimentProgressProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-primary">
          {baselineLabel}
        </span>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-widest">
          {protocolLabel}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Analysis
        </span>
      </div>
      <Progress value={overallPercent} className="h-1.5" />
    </div>
  );
}
