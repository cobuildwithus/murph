import type { SVGProps } from "react";

const svgDefaults = {
  viewBox: "0 0 100 100",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function WatchHeartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      {/* Watch body */}
      <rect x={24} y={18} width={52} height={64} rx={12} />
      {/* Band top */}
      <path d="M 36 18 L 36 8 L 64 8 L 64 18" />
      {/* Band bottom */}
      <path d="M 36 82 L 36 92 L 64 92 L 64 82" />
      {/* Heart on screen */}
      <path d="M 50 64 C 34 54 28 44 36 36 C 42 30 48 34 50 40 C 52 34 58 30 64 36 C 72 44 66 54 50 64 Z" />
    </svg>
  );
}

export function ChartPulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      <path d="M 10 80 L 10 20" />
      <path d="M 10 80 L 90 80" />
      <path d="M 24 64 L 40 46 L 56 54 L 76 30" />
      <path d="M 66 30 L 76 30 L 76 40" />
    </svg>
  );
}

export function LabReportIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      {/* Clipboard body */}
      <rect x={12} y={16} width={60} height={72} rx={4} />
      {/* Clipboard clip */}
      <rect x={30} y={8} width={24} height={16} rx={3} />
      {/* Text lines */}
      <path d="M 24 42 L 56 42" />
      <path d="M 24 54 L 50 54" />
      <path d="M 24 66 L 44 66" />
      {/* Magnifying glass */}
      <circle cx={72} cy={68} r={14} />
      <path d="M 82 78 L 92 88" strokeWidth={3.5} />
    </svg>
  );
}

export function WatchCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      {/* Watch body */}
      <rect x={24} y={18} width={52} height={64} rx={12} />
      {/* Band top */}
      <path d="M 36 18 L 36 8 L 64 8 L 64 18" />
      {/* Band bottom */}
      <path d="M 36 82 L 36 92 L 64 92 L 64 82" />
      {/* Checkmark on screen */}
      <path d="M 37 50 L 46 59 L 63 40" strokeWidth={4} />
    </svg>
  );
}

export function FlaskSparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svgDefaults} {...props}>
      {/* Flask */}
      <path d="M 36 12 L 64 12" />
      <path d="M 38 12 L 38 40 L 16 84 C 14 89 18 94 24 94 L 76 94 C 82 94 86 89 84 84 L 62 40 L 62 12" />
      {/* Liquid line */}
      <path d="M 24 78 L 76 78" strokeWidth={2} />
      {/* Sparkle large */}
      <path d="M 78 20 L 78 8" />
      <path d="M 72 14 L 84 14" />
      {/* Sparkle small */}
      <path d="M 86 36 L 86 28" strokeWidth={2.5} />
      <path d="M 82 32 L 90 32" strokeWidth={2.5} />
    </svg>
  );
}
