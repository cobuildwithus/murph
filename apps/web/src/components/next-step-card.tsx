import { cn } from "@/src/lib/utils";

interface NextStepCardProps {
  title: string;
  when: string;
  instructions?: string;
  context?: string;
  nextSession?: string;
  className?: string;
}

export function NextStepCard({
  title,
  when,
  instructions,
  context,
  nextSession,
  className,
}: NextStepCardProps) {
  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-xl border border-primary/15 bg-primary/[0.06]",
        className
      )}
    >
      <div className="flex flex-1 items-center justify-between px-7 py-6">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
            Next Step · {when}
          </span>
          <span className="font-serif text-xl font-semibold text-foreground">
            {title}
          </span>
          {(instructions || context) && (
            <span className="text-sm text-muted-foreground">
              {instructions}
              {instructions && context && " · "}
              {context}
            </span>
          )}
        </div>
        {nextSession && (
          <div className="flex shrink-0 flex-col items-end gap-1 pl-8">
            <span className="text-xs text-muted-foreground">Next session</span>
            <span className="text-sm font-semibold text-foreground">
              {nextSession}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
