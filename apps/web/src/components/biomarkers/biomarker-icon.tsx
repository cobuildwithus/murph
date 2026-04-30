import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

// Single-stroke line-art glyphs authored to share a visual register with the
// existing Quiver About icons. Uses `currentColor` so callers control hue.
const ICONS: Record<string, ReactNode> = {
  // Heart outline with a single ECG pulse threaded through it.
  "resting-heart-rate": (
    <>
      <path d="M 50 82 C 18 65 8 42 22 28 C 33 18 46 23 50 38 C 54 23 67 18 78 28 C 92 42 82 65 50 82 Z" />
      <path
        d="M 18 52 L 30 52 L 36 42 L 44 64 L 50 32 L 56 60 L 62 52 L 82 52"
        strokeWidth={2}
      />
    </>
  ),
  // Variable-height waveform — the variability itself is the icon.
  "hrv-rmssd": (
    <path d="M 8 60 L 18 60 L 24 42 L 30 70 L 36 52 L 44 56 L 48 28 L 54 64 L 60 48 L 68 68 L 74 44 L 82 54 L 92 54" />
  ),
  // Stylized lungs with central trachea.
  "estimated-vo2max": (
    <>
      <path d="M 50 22 L 50 55" />
      <path d="M 48 36 C 32 36 24 56 28 78 C 30 86 42 88 48 80 Z" />
      <path d="M 52 36 C 68 36 76 56 72 78 C 70 86 58 88 52 80 Z" />
    </>
  ),
  // Blood droplet with an inner glucose-response curve.
  "blood-glucose": (
    <>
      <path d="M 50 14 C 35 38 24 52 24 65 C 24 80 35 90 50 90 C 65 90 76 80 76 65 C 76 52 65 38 50 14 Z" />
      <path d="M 34 64 Q 42 54 50 60 Q 58 66 66 52" strokeWidth={2} />
    </>
  ),
  // Crescent moon outline — keeps the line-art register of the rest.
  "deep-sleep-minutes": (
    <path d="M 72 16 A 38 38 0 1 0 84 70 A 28 28 0 1 1 72 16 Z" />
  ),
  // Open eye — REM = Rapid Eye Movement.
  "rem-sleep-minutes": (
    <>
      <path d="M 8 50 C 22 28 35 25 50 25 C 65 25 78 28 92 50 C 78 72 65 75 50 75 C 35 75 22 72 8 50 Z" />
      <circle cx={50} cy={50} r={13} />
    </>
  ),
  // Two oxygen atoms forming O₂.
  "blood-oxygen-spo2": (
    <>
      <circle cx={34} cy={50} r={20} />
      <circle cx={66} cy={50} r={20} />
    </>
  ),
};

export function BiomarkerIcon({
  routeId,
  className,
}: {
  routeId: string;
  className?: string;
}) {
  const icon = ICONS[routeId];
  if (!icon) return null;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className={cn("text-primary/85", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon}
    </svg>
  );
}
