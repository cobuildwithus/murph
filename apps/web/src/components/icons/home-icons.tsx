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
