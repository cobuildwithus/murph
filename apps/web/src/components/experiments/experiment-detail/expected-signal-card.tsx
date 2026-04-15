import { cn } from "@/src/lib/utils";

interface ExpectedSignalCardProps {
  label: string;
  expected: string;
  direction: "up" | "down" | "neutral";
  description: string;
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
  className,
}: ExpectedSignalCardProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-xl border border-primary/20 bg-primary/4 p-5",
        className
      )}
    >
      <span className="font-mono text-[10px]/3 tracking-widest text-ring">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="font-serif text-[28px]/8.5 font-semibold text-primary">
          {arrows[direction]}
        </span>
        <span className="text-sm/4.5 font-semibold text-primary">
          {expected} expected
        </span>
      </div>
      <p className="text-[12px] leading-[150%] text-chart-5">
        {description}
      </p>
      <svg
        width="100%"
        height="32"
        viewBox="0 0 220 32"
        preserveAspectRatio="none"
        className="shrink-0"
      >
        <polyline
          points={sparklines[direction]}
          fill="none"
          stroke="#7A8C6E"
          strokeWidth="1.5"
        />
        <polyline
          points={baselinePoints[direction]}
          fill="none"
          stroke="#D4C4A8"
          strokeDasharray="4,4"
        />
      </svg>
    </div>
  );
}
