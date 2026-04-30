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
  // Sphygmomanometer cuff with pressure wave.
  "morning-blood-pressure": (
    <>
      <rect x={28} y={20} rx={6} width={44} height={60} />
      <path d="M 38 50 L 46 38 L 54 58 L 62 46" strokeWidth={2} />
    </>
  ),
  "blood-pressure": (
    <>
      <rect x={28} y={20} rx={6} width={44} height={60} />
      <path d="M 38 50 L 46 38 L 54 58 L 62 46" strokeWidth={2} />
    </>
  ),
  // Smiley face — simple mood indicator.
  "self-reported-mood": (
    <>
      <circle cx={50} cy={50} r={36} />
      <circle cx={38} cy={42} r={3} fill="currentColor" stroke="none" />
      <circle cx={62} cy={42} r={3} fill="currentColor" stroke="none" />
      <path d="M 34 60 Q 50 74 66 60" />
    </>
  ),
  "mood-affect": (
    <>
      <circle cx={50} cy={50} r={36} />
      <circle cx={38} cy={42} r={3} fill="currentColor" stroke="none" />
      <circle cx={62} cy={42} r={3} fill="currentColor" stroke="none" />
      <path d="M 34 60 Q 50 74 66 60" />
    </>
  ),
  // Scale / weighing platform.
  "body-weight": (
    <>
      <ellipse cx={50} cy={72} rx={34} ry={12} />
      <path d="M 50 60 L 50 36" />
      <path d="M 38 42 L 50 36 L 62 42" />
    </>
  ),
  // Bed with zzz — sleep onset.
  "sleep-onset-latency": (
    <>
      <path d="M 16 68 L 84 68" />
      <path d="M 20 68 L 20 38 L 80 38 L 80 68" />
      <path d="M 60 28 L 68 20 L 60 20" strokeWidth={2} />
      <path d="M 68 34 L 76 26 L 68 26" strokeWidth={2} />
    </>
  ),
  // Clock face with efficiency arc.
  "sleep-efficiency": (
    <>
      <circle cx={50} cy={50} r={34} />
      <path d="M 50 50 L 50 26" />
      <path d="M 50 50 L 66 58" />
      <path d="M 76 24 A 34 34 0 0 1 82 42" strokeWidth={3} />
    </>
  ),
  // Total sleep — bed outline with full wave.
  "total-sleep-time": (
    <>
      <path d="M 16 68 L 84 68" />
      <path d="M 20 68 L 20 38 L 80 38 L 80 68" />
      <path d="M 30 52 Q 42 40 50 52 Q 58 64 70 52" strokeWidth={2} />
    </>
  ),
  // Walking figure with steps.
  "walking-safety-events": (
    <>
      <circle cx={50} cy={18} r={8} />
      <path d="M 50 26 L 50 56" />
      <path d="M 50 36 L 34 50" />
      <path d="M 50 36 L 66 50" />
      <path d="M 50 56 L 36 80" />
      <path d="M 50 56 L 64 80" />
    </>
  ),
  // Cholesterol — artery cross-section with plaque.
  "ldl-c": (
    <>
      <circle cx={50} cy={50} r={34} />
      <circle cx={50} cy={50} r={18} />
    </>
  ),
  "ldl-cholesterol": (
    <>
      <circle cx={50} cy={50} r={34} />
      <circle cx={50} cy={50} r={18} />
    </>
  ),
  "total-cholesterol": (
    <>
      <circle cx={50} cy={50} r={34} />
      <circle cx={50} cy={50} r={18} />
    </>
  ),
  "non-hdl-c": (
    <>
      <circle cx={50} cy={50} r={34} />
      <circle cx={50} cy={50} r={18} />
    </>
  ),
  "non-hdl-cholesterol": (
    <>
      <circle cx={50} cy={50} r={34} />
      <circle cx={50} cy={50} r={18} />
    </>
  ),
  "hdl-c": (
    <>
      <circle cx={50} cy={50} r={34} />
      <circle cx={50} cy={50} r={18} />
      <path d="M 38 50 L 46 58 L 64 40" strokeWidth={2} />
    </>
  ),
  // Triglyceride — three droplets.
  "triglycerides": (
    <>
      <path d="M 28 30 C 22 42 16 50 16 58 C 16 66 21 72 28 72 C 35 72 40 66 40 58 C 40 50 34 42 28 30 Z" />
      <path d="M 50 18 C 44 30 38 38 38 46 C 38 54 43 60 50 60 C 57 60 62 54 62 46 C 62 38 56 30 50 18 Z" />
      <path d="M 72 30 C 66 42 60 50 60 58 C 60 66 65 72 72 72 C 79 72 84 66 84 58 C 84 50 78 42 72 30 Z" />
    </>
  ),
  "fasting-triglycerides": (
    <>
      <path d="M 28 30 C 22 42 16 50 16 58 C 16 66 21 72 28 72 C 35 72 40 66 40 58 C 40 50 34 42 28 30 Z" />
      <path d="M 50 18 C 44 30 38 38 38 46 C 38 54 43 60 50 60 C 57 60 62 54 62 46 C 62 38 56 30 50 18 Z" />
      <path d="M 72 30 C 66 42 60 50 60 58 C 60 66 65 72 72 72 C 79 72 84 66 84 58 C 84 50 78 42 72 30 Z" />
    </>
  ),
  // Apolipoprotein B — lipoprotein sphere.
  "apolipoprotein-b": (
    <>
      <circle cx={50} cy={50} r={30} />
      <ellipse cx={50} cy={50} rx={30} ry={12} />
    </>
  ),
  // Tape measure — waist circumference.
  "waist-circumference": (
    <>
      <ellipse cx={50} cy={50} rx={28} ry={36} />
      <path d="M 22 50 L 78 50" strokeWidth={2} />
      <path d="M 30 44 L 30 50" />
      <path d="M 40 44 L 40 50" />
      <path d="M 50 44 L 50 50" />
      <path d="M 60 44 L 60 50" />
      <path d="M 70 44 L 70 50" />
    </>
  ),
  // Body silhouette with percent marker.
  "body-fat-percent": (
    <>
      <circle cx={50} cy={22} r={10} />
      <path d="M 50 32 L 50 60" />
      <path d="M 50 40 L 34 52" />
      <path d="M 50 40 L 66 52" />
      <path d="M 50 60 L 38 82" />
      <path d="M 50 60 L 62 82" />
      <circle cx={76} cy={76} r={12} />
    </>
  ),
  // Flexed arm — lean mass.
  "lean-mass": (
    <>
      <path d="M 30 70 C 30 50 36 40 50 36 C 58 34 66 38 70 46" />
      <path d="M 70 46 C 74 54 72 64 66 70" />
      <path d="M 30 70 C 34 76 44 78 52 76 L 66 70" />
    </>
  ),
  "lean-body-mass": (
    <>
      <path d="M 30 70 C 30 50 36 40 50 36 C 58 34 66 38 70 46" />
      <path d="M 70 46 C 74 54 72 64 66 70" />
      <path d="M 30 70 C 34 76 44 78 52 76 L 66 70" />
    </>
  ),
  // Brain with stress wave.
  "perceived-stress": (
    <>
      <path d="M 50 16 C 30 16 18 30 18 48 C 18 68 34 84 50 84 C 66 84 82 68 82 48 C 82 30 70 16 50 16 Z" />
      <path d="M 50 16 L 50 84" />
      <path d="M 30 42 L 38 36 L 46 44 L 54 34 L 62 42 L 70 36" strokeWidth={2} />
    </>
  ),
  // Foot stepping — daily steps.
  "daily-step-count": (
    <>
      <path d="M 36 80 C 28 78 22 66 24 54 C 26 42 34 28 44 26 C 54 24 58 32 56 46 C 54 60 48 78 36 80 Z" />
      <circle cx={64} cy={20} r={6} />
      <circle cx={76} cy={26} r={5} />
    </>
  ),
  // Sunrise with clock — wake-time variability.
  "wake-time-variability": (
    <>
      <path d="M 14 62 L 86 62" />
      <path d="M 50 62 A 24 24 0 0 1 74 62" />
      <path d="M 50 62 A 24 24 0 0 1 26 62" />
      <path d="M 50 14 L 50 24" />
      <path d="M 24 36 L 30 42" />
      <path d="M 76 36 L 70 42" />
    </>
  ),
  // Drowsy eye — daytime sleepiness.
  "daytime-sleepiness": (
    <>
      <path d="M 8 50 C 22 34 35 30 50 30 C 65 30 78 34 92 50 C 78 66 65 70 50 70 C 35 70 22 66 8 50 Z" />
      <path d="M 34 50 L 66 50" strokeWidth={2} />
    </>
  ),
  // Wine glass with X — alcohol-free days.
  "alcohol-free-days": (
    <>
      <path d="M 36 18 L 50 48 L 64 18" />
      <path d="M 50 48 L 50 76" />
      <path d="M 38 76 L 62 76" />
      <path d="M 34 56 L 66 72" strokeWidth={2} />
      <path d="M 66 56 L 34 72" strokeWidth={2} />
    </>
  ),
  // Sleep quality — star with moon.
  "sleep-quality": (
    <>
      <path d="M 40 20 L 44 34 L 58 34 L 46 42 L 50 56 L 40 46 L 30 56 L 34 42 L 22 34 L 36 34 Z" />
      <path d="M 72 24 A 18 18 0 1 0 80 54 A 14 14 0 1 1 72 24 Z" />
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
