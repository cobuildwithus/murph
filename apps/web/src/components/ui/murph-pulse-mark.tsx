"use client";

import { cn } from "@/lib/utils";

// Animated Murph mark: warm center dots breathe first, mid amber ring trails by
// 200ms, sage outer ring by 400ms - a quiet ripple radiating from the core.
export function MurphPulseMark({ className }: { className?: string }) {
  const core = "animate-pulse [animation-duration:1800ms]";
  const mid = "animate-pulse [animation-duration:1800ms] [animation-delay:200ms]";
  const outer = "animate-pulse [animation-duration:1800ms] [animation-delay:400ms]";

  return (
    <svg
      aria-hidden="true"
      className={cn("block", className)}
      data-murph-pulse-mark="true"
      fill="none"
      viewBox="0 0 65 44"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="16.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="27" cy="5.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="38" cy="5.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="48.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="58.5" cy="5.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="4.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="14.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={mid} />
      <circle cx="26" cy="15.5" r="3.5" fill="#a07a4e" className={core} />
      <circle cx="39" cy="15.5" r="3.5" fill="#a07a4e" className={core} />
      <circle cx="50.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={mid} />
      <circle cx="60.5" cy="15.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="2" cy="27.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="12.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="25" cy="27.5" r="4" fill="#8b6840" className={core} />
      <circle cx="39.5" cy="27.5" r="4.5" fill="#8b6840" className={core} />
      <circle cx="52.5" cy="27.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="63" cy="27.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="6.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="16.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="27" cy="38.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="38" cy="38.5" r="2.5" fill="#c4956a" fillOpacity=".55" className={mid} />
      <circle cx="48.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
      <circle cx="58.5" cy="38.5" r="2" fill="#b5c4a1" fillOpacity=".3" className={outer} />
    </svg>
  );
}
