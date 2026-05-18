/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pitch deck framework — shared layout primitives: the slide shell,
   the fixed chrome (logo, counter, dot rail, progress bar), and the
   small typographic helpers every slide reuses.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export type Tone = "cream" | "sand" | "dark";

// Tone per slide, in order. Drives the deck chrome (logo, counter, rail).
export const TONES: readonly Tone[] = [
  "dark", // 00 title
  "cream", // 01 problem
  "dark", // 02 insight
  "cream", // 03 why now / market
  "sand", // 04 product
  "dark", // 05 example experiment
  "cream", // 06 how it spreads
  "sand", // 07 early validation
  "cream", // 08 competition
  "dark", // 09 moat
  "dark", // 10 team / roadmap
  "dark", // 11 the ask
];
export const TOTAL = TONES.length;

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ DECK CHROME ━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function DeckChrome({
  active,
  dark,
  onJump,
}: {
  active: number;
  dark: boolean;
  onJump: (index: number) => void;
}) {
  return (
    <>
      {/* Top bar — logo + slide counter */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center justify-between px-6 py-5 sm:px-10 lg:px-16">
        <Link
          href="/"
          className="pointer-events-auto inline-flex"
          aria-label="Murph home"
        >
          <img
            src={dark ? "/logo-dark.svg" : "/logo.svg"}
            alt="Murph"
            className="h-5 w-auto"
          />
        </Link>
        <span
          className={`font-mono text-[11px] uppercase tracking-[0.14em] ${
            dark ? "text-[#e9e2d4]/55" : "text-[#736a58]"
          }`}
        >
          {String(active + 1).padStart(2, "0")} /{" "}
          {String(TOTAL).padStart(2, "0")}
        </span>
      </div>

      {/* Right dot rail */}
      <nav
        aria-label="Slides"
        className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-2.5 md:flex lg:right-8"
      >
        {TONES.map((_, index) => {
          const current = index === active;
          return (
            <button
              key={index}
              type="button"
              onClick={() => onJump(index)}
              aria-label={`Go to slide ${index + 1}`}
              aria-current={current ? "true" : undefined}
              className={`w-[3px] rounded-full transition-all duration-300 ${
                current
                  ? "h-6 bg-[#7a8c6e]"
                  : `h-2.5 ${dark ? "bg-[#f5f0e8]/25" : "bg-[#2d3436]/15"}`
              }`}
            />
          );
        })}
      </nav>

      {/* Bottom progress line */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 h-[3px] ${
          dark ? "bg-[#f5f0e8]/10" : "bg-[#2d3436]/8"
        }`}
      >
        <div
          className="h-full bg-[#7a8c6e] transition-[width] duration-500 ease-out"
          style={{ width: `${((active + 1) / TOTAL) * 100}%` }}
        />
      </div>
    </>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ SLIDE PRIMITIVES ━━━━━━━━━━━━━━━━━━━━ */

export function Slide({
  index,
  tone,
  label,
  children,
}: {
  index: number;
  tone: Tone;
  label: string;
  children: ReactNode;
}) {
  const dark = tone === "dark";
  const surface = dark
    ? "bg-gradient-to-b from-[#2d3436] via-[#3a2e24] to-[#2a1f16]"
    : tone === "sand"
      ? "bg-[#ebe3d2]"
      : "bg-[#f5f0e8]";
  return (
    <section
      id={`pitch-slide-${index}`}
      data-pitch-slide
      data-index={index}
      aria-label={`Slide ${index + 1}: ${label}`}
      className={`relative flex min-h-svh snap-start snap-always flex-col justify-center overflow-hidden px-6 py-24 sm:px-10 sm:py-28 lg:px-16 ${surface}`}
    >
      {dark ? <AmbientField /> : null}
      <div className="relative z-10 mx-auto w-full max-w-[1080px]">
        {children}
      </div>
    </section>
  );
}

function AmbientField() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(circle at 28% 62%, rgba(160,122,78,0.26) 0%, transparent 50%), radial-gradient(circle at 72% 32%, rgba(140,104,64,0.16) 0%, transparent 42%), radial-gradient(circle at 55% 85%, rgba(196,149,106,0.1) 0%, transparent 36%)",
      }}
    />
  );
}

export function Eyebrow({
  children,
  dark,
}: {
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <p
      className={`font-mono text-[11px] font-medium uppercase tracking-[0.18em] ${
        dark ? "text-[#9fb389]" : "text-[#5a6e32]"
      }`}
    >
      {children}
    </p>
  );
}

export function SlideHeading({
  children,
  dark,
  wide,
}: {
  children: ReactNode;
  dark?: boolean;
  wide?: boolean;
}) {
  return (
    <h2
      className={`mt-5 font-serif text-[clamp(1.9rem,4vw,3.1rem)] font-semibold leading-[1.08] tracking-[-0.03em] ${
        wide ? "max-w-[40ch]" : "max-w-[22ch]"
      } ${dark ? "text-[#f5f0e8]" : "text-[#2d3436]"}`}
    >
      {children}
    </h2>
  );
}

export function ChevronDown() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-3.5">
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
