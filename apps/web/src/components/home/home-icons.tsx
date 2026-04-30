import type { SVGProps } from "react";

export function WatchHeartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 2.5h6L14.5 5h-5L9 2.5Z" />
      <path d="M9 21.5h6L14.5 19h-5L9 21.5Z" />
      <rect x="5.5" y="5" width="13" height="14" rx="3.5" />
      <path d="M12 9.8c-.6-.9-2-1.1-2.6-.3s-.4 2 .8 3.1L12 14.2l1.8-1.6c1.2-1.1 1.4-2.3.8-3.1s-2-.6-2.6.3Z" strokeWidth={1.2} fill="currentColor" fillOpacity={0.12} />
    </svg>
  );
}

export function ChartPulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 20V6M3 20h18" />
      <path d="M7 16l3-4 3 2 4-6" strokeWidth={1.6} />
      <path d="M17 8l0.5-0.5M17 8h-2" strokeWidth={1.6} />
      <circle cx="18.5" cy="5" r="1.2" fill="currentColor" stroke="none" opacity={0.35} />
      <circle cx="21" cy="3.5" r="0.8" fill="currentColor" stroke="none" opacity={0.25} />
    </svg>
  );
}

export function LabReportIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1Z" />
      <path d="M9 7h6M9 10.5h6M9 14h3" strokeWidth={1.3} />
      <path d="M16 17l1.5-1.5M14.5 15.5a2 2 0 104 0 2 2 0 00-4 0Z" strokeWidth={1.3} />
    </svg>
  );
}

export function FlaskSparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 3h6M10 3v6.5L5 19.5a1.5 1.5 0 001.3 2.25h11.4a1.5 1.5 0 001.3-2.25L14 9.5V3" />
      <path d="M7.5 15h9" strokeWidth={1.2} />
      <path d="M18.5 3l.5 1.5.5-1.5.5 1.5.5-1.5" strokeWidth={1.2} strokeLinejoin="round" />
      <circle cx="19" cy="7" r="0.6" fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx="20.5" cy="5.5" r="0.4" fill="currentColor" stroke="none" opacity={0.3} />
    </svg>
  );
}
