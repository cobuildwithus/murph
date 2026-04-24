import { cn } from "@/src/lib/utils";

interface ExpectedSignalCardProps {
  label: string;
  expected: string;
  direction: "up" | "down" | "neutral";
  description: string;
  variant?: "primary" | "supporting";
  className?: string;
}

const arrows: Record<string, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
};

const sparklines: Record<string, string> = {
  up: "0,28 30,24 60,22 90,18 120,14 150,10 180,8 220,4",
  down: "0,4 30,8 60,12 90,16 120,20 150,22 180,26 220,28",
  neutral: "0,16 30,15 60,16 90,15 120,16 150,15 180,16 220,15",
};

const baselinePoints: Record<string, string> = {
  up: "0,28 220,26",
  down: "0,4 220,6",
  neutral: "0,16 220,16",
};

export function ExpectedSignalCard({
  label,
  expected,
  direction,
  description,
  variant = "supporting",
  className,
}: ExpectedSignalCardProps) {
  const isPrimary = variant === "primary";
  return (
    <div
      className={cn(
        "flex flex-1 flex-col rounded-xl border",
        isPrimary
          ? "gap-4 border-primary/35 bg-primary/12 p-6"
          : "gap-3 border-primary/20 bg-primary/5 p-5",
        className,
      )}
    >
      <span
        className={cn(
          "font-mono uppercase tracking-[0.12em]",
          isPrimary ? "text-[11px]/3.5 text-primary" : "text-[10px]/3 text-ring",
        )}
      >
        {isPrimary ? `Primary signal · ${label}` : label}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-serif font-semibold text-primary",
            isPrimary ? "text-[44px]/11" : "text-[32px]/9",
          )}
        >
          {arrows[direction]}
        </span>
        <span
          className={cn(
            "font-serif font-semibold text-primary",
            isPrimary ? "text-2xl" : "text-lg",
          )}
        >
          {expected}
        </span>
      </div>
      <p className={cn("text-foreground", isPrimary ? "text-[15px]/6" : "text-sm/6")}>
        {description}
      </p>
      <svg
        width="100%"
        height={isPrimary ? 44 : 32}
        viewBox="0 0 220 32"
        preserveAspectRatio="none"
        className="mt-1 shrink-0"
      >
        <polyline
          points={baselinePoints[direction]}
          fill="none"
          className="stroke-secondary"
          strokeDasharray="4,4"
        />
        <polyline
          points={sparklines[direction]}
          fill="none"
          className="stroke-primary"
          strokeWidth={isPrimary ? 2 : 1.75}
        />
      </svg>
    </div>
  );
}
