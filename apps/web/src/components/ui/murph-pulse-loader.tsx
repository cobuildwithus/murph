"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

type Ring = "core" | "mid" | "outer";

type Dot = {
  cx: number;
  cy: number;
  r: number;
  ring: Ring;
};

const DOTS: Dot[] = [
  { cx: 6.5, cy: 5.5, r: 2, ring: "outer" },
  { cx: 16.5, cy: 5.5, r: 2, ring: "outer" },
  { cx: 27, cy: 5.5, r: 2.5, ring: "mid" },
  { cx: 38, cy: 5.5, r: 2.5, ring: "mid" },
  { cx: 48.5, cy: 5.5, r: 2, ring: "outer" },
  { cx: 58.5, cy: 5.5, r: 2, ring: "outer" },
  { cx: 4.5, cy: 15.5, r: 2, ring: "outer" },
  { cx: 14.5, cy: 15.5, r: 2, ring: "mid" },
  { cx: 26, cy: 15.5, r: 3.5, ring: "core" },
  { cx: 39, cy: 15.5, r: 3.5, ring: "core" },
  { cx: 50.5, cy: 15.5, r: 2, ring: "mid" },
  { cx: 60.5, cy: 15.5, r: 2, ring: "outer" },
  { cx: 2, cy: 27.5, r: 2, ring: "outer" },
  { cx: 12.5, cy: 27.5, r: 2.5, ring: "mid" },
  { cx: 25, cy: 27.5, r: 4, ring: "core" },
  { cx: 39.5, cy: 27.5, r: 4.5, ring: "core" },
  { cx: 52.5, cy: 27.5, r: 2.5, ring: "mid" },
  { cx: 63, cy: 27.5, r: 2, ring: "outer" },
  { cx: 6.5, cy: 38.5, r: 2, ring: "outer" },
  { cx: 16.5, cy: 38.5, r: 2, ring: "outer" },
  { cx: 27, cy: 38.5, r: 2.5, ring: "mid" },
  { cx: 38, cy: 38.5, r: 2.5, ring: "mid" },
  { cx: 48.5, cy: 38.5, r: 2, ring: "outer" },
  { cx: 58.5, cy: 38.5, r: 2, ring: "outer" },
];

const CENTER_X = 32.25;
const CENTER_Y = 21.5;
const DELAY_PER_UNIT_MS = 28;
const RIPPLE_DURATION_MS = 1800;

const RING_STYLE: Record<Ring, {
  fill: string;
  restOpacity: number;
  peakOpacity: number;
  scale: number;
}> = {
  core: {
    fill: "#8b6840",
    restOpacity: 1,
    peakOpacity: 1,
    scale: 1.18,
  },
  mid: {
    fill: "#c4956a",
    restOpacity: 0.55,
    peakOpacity: 1,
    scale: 1.45,
  },
  outer: {
    fill: "#b5c4a1",
    restOpacity: 0.3,
    peakOpacity: 0.95,
    scale: 1.6,
  },
};

function dotDelayMs(cx: number, cy: number): number {
  const dx = cx - CENTER_X;
  const dy = cy - CENTER_Y;
  return Math.round(Math.hypot(dx, dy) * DELAY_PER_UNIT_MS);
}

export function MurphPulseLoader({
  className,
  durationMs = RIPPLE_DURATION_MS,
}: {
  className?: string;
  durationMs?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("block", className)}
      fill="none"
      viewBox="-4 -4 73 52"
      xmlns="http://www.w3.org/2000/svg"
      style={{ "--murph-loader-duration": `${durationMs}ms` } as CSSProperties}
    >
      {DOTS.map((dot, index) => {
        const style = RING_STYLE[dot.ring];
        const delay = dotDelayMs(dot.cx, dot.cy);
        return (
          <circle
            key={index}
            cx={dot.cx}
            cy={dot.cy}
            r={dot.r}
            fill={dot.ring === "core" && dot.r < 4 ? "#a07a4e" : style.fill}
            className="murph-loader-dot"
            style={{
              "--dot-delay": `${delay}ms`,
              "--dot-opacity": style.restOpacity,
              "--dot-opacity-peak": style.peakOpacity,
              "--dot-scale": style.scale,
            } as CSSProperties}
          />
        );
      })}
    </svg>
  );
}
