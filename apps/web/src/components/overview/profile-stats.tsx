import type { ProfileStats as ProfileStatsType } from "@/src/types/experiments";

export function ProfileStats({ completed, daysTracked }: ProfileStatsType) {
  return (
    <div className="flex h-full gap-px overflow-hidden rounded-xl border border-border">
      <div className="flex flex-col items-center justify-center bg-card px-6 py-4">
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Completed
        </span>
        <span className="font-serif text-2xl font-semibold text-foreground">
          {completed}
        </span>
      </div>
      <div className="w-px bg-border" />
      <div className="flex flex-col items-center justify-center bg-card px-6 py-4">
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Days tracked
        </span>
        <span className="font-serif text-2xl font-semibold text-foreground">
          {daysTracked}
        </span>
      </div>
    </div>
  );
}
