import { TimelineEntry } from "@/src/components/ui/timeline-entry";
import type { TimelineEvent } from "@/src/types/experiments";

interface ExperimentTimelineProps {
  events: TimelineEvent[];
}

export function ExperimentTimeline({ events }: ExperimentTimelineProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Timeline
      </span>
      <div className="flex flex-col gap-3">
        {events.map((event, i) => (
          <TimelineEntry
            key={i}
            date={event.date}
            label={event.label}
            title={event.title}
            description={event.description}
            variant={event.variant}
            upcoming={event.upcoming}
            last={event.last}
          />
        ))}
      </div>
    </div>
  );
}
