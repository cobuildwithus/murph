import Link from "next/link";
import type { ActiveExperiment } from "@/src/types/experiments";

export function ActiveExperimentBanner({
  id,
  title,
  day,
  totalDays,
}: ActiveExperiment) {
  return (
    <Link
      href={`/experiments/${id}`}
      className="flex h-full items-center justify-between rounded-xl border border-border bg-card px-5 py-4"
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Active experiment
          </span>
          <span className="text-sm font-semibold text-foreground">
            <span className="mr-2 inline-block size-2 rounded-full bg-amber-500" />
            {title} · Day {day} of {totalDays}
          </span>
        </div>
      </div>
      <span className="text-sm text-muted-foreground">View →</span>
    </Link>
  );
}
