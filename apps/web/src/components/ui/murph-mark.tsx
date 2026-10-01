import { cn } from "@/src/lib/utils";

const MURPH_MARK_DOTS: readonly [
  cx: number,
  cy: number,
  r: number,
  fill: string,
  opacity?: number,
][] = [
  [6.5, 5.5, 2, "#b5c4a1", 0.3],
  [16.5, 5.5, 2, "#b5c4a1", 0.3],
  [27, 5.5, 2.5, "#c4956a", 0.55],
  [38, 5.5, 2.5, "#c4956a", 0.55],
  [48.5, 5.5, 2, "#b5c4a1", 0.3],
  [58.5, 5.5, 2, "#b5c4a1", 0.3],
  [4.5, 15.5, 2, "#b5c4a1", 0.3],
  [14.5, 15.5, 2, "#b5c4a1", 0.3],
  [26, 15.5, 3.5, "#a07a4e"],
  [39, 15.5, 3.5, "#a07a4e"],
  [50.5, 15.5, 2, "#b5c4a1", 0.3],
  [60.5, 15.5, 2, "#b5c4a1", 0.3],
  [2, 27.5, 2, "#b5c4a1", 0.3],
  [12.5, 27.5, 2.5, "#c4956a", 0.55],
  [25, 27.5, 4, "#8b6840"],
  [39.5, 27.5, 4.5, "#8b6840"],
  [52.5, 27.5, 2.5, "#c4956a", 0.55],
  [63, 27.5, 2, "#b5c4a1", 0.3],
  [6.5, 38.5, 2, "#b5c4a1", 0.3],
  [16.5, 38.5, 2, "#b5c4a1", 0.3],
  [27, 38.5, 2.5, "#c4956a", 0.55],
  [38, 38.5, 2.5, "#c4956a", 0.55],
  [48.5, 38.5, 2, "#b5c4a1", 0.3],
  [58.5, 38.5, 2, "#b5c4a1", 0.3],
];

export function MurphMark(input: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 65 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-auto shrink-0", input.className)}
    >
      {MURPH_MARK_DOTS.map(([cx, cy, r, fill, opacity]) => (
        <circle
          key={`${cx}:${cy}`}
          cx={cx}
          cy={cy}
          r={r}
          fill={fill}
          fillOpacity={opacity}
        />
      ))}
    </svg>
  );
}
