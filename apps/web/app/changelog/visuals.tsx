import type { ReactNode } from "react";

const FRAME_BASE =
  "mt-5 w-full max-w-[320px] overflow-hidden rounded-[20px] border border-[#2d3436]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_30px_-18px_rgba(45,52,54,0.22)]";

const FRAME_HEADER =
  "flex items-center justify-between border-b border-[#2d3436]/8 bg-[#fafaf6] px-4 py-2.5";

const HEADER_LABEL =
  "font-mono text-[10px] font-medium tracking-[0.18em] text-[#736a58] uppercase";

const HEADER_META = "font-mono text-[10px] text-[#a39684]";

export function StatBlock({
  label,
  value,
  before,
  after,
  caption,
}: {
  label: string;
  value?: string;
  before?: string;
  after?: string;
  caption?: string;
}) {
  const isComparison = before !== undefined && after !== undefined;
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 px-5 py-7">
        {isComparison ? (
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-[1.7rem] leading-none text-[#736a58] line-through decoration-[#c4a882]/60">
              {before}
            </span>
            <span aria-hidden="true" className="text-[#a39684]">
              →
            </span>
            <span className="font-serif text-[2rem] font-semibold leading-none text-[#3a4a1e]">
              {after}
            </span>
          </div>
        ) : (
          <span className="font-serif text-[2.6rem] font-semibold leading-none tracking-tight text-[#3a4a1e]">
            {value}
          </span>
        )}
        {caption ? (
          <p className="mt-1 font-mono text-[11px] tracking-[0.04em] text-[#736a58]">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export type TerminalLine = {
  command: string;
  timing?: string;
};

export function TerminalMock({
  lines,
  label = "vault-cli",
}: {
  label?: string;
  lines: readonly TerminalLine[];
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-[#e8b4ad]" />
          <span aria-hidden="true" className="size-2 rounded-full bg-[#e8d4a1]" />
          <span aria-hidden="true" className="size-2 rounded-full bg-[#b3c794]" />
        </div>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex flex-col gap-1.5 bg-[#1f241c] px-4 py-3.5 font-mono text-[12px] leading-[1.5] text-[#e8e3d3]">
        {lines.map((line, index) => (
          <div key={index} className="flex items-center gap-3">
            <span aria-hidden="true" className="text-[#83945f]">
              $
            </span>
            <span className="min-w-0 flex-1 truncate">{line.command}</span>
            {line.timing ? (
              <span className="shrink-0 text-[#a39684] tabular-nums">
                {line.timing}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export type AppEntry = {
  color: string;
  name: string;
};

export function AppGrid({
  apps,
  caption,
}: {
  apps: readonly AppEntry[];
  caption?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>Connected apps</p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3.5">
        {apps.map((app) => (
          <div
            key={app.name}
            className="flex items-center gap-2.5 rounded-lg border border-[#2d3436]/8 bg-[#fffcf6] px-2.5 py-2"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
              style={{ backgroundColor: app.color }}
            >
              {app.name.charAt(0)}
            </span>
            <span className="min-w-0 truncate text-[12.5px] font-medium text-[#2d3436]">
              {app.name}
            </span>
          </div>
        ))}
      </div>
      {caption ? (
        <div className="border-t border-[#2d3436]/8 px-4 py-2 text-center">
          <p className="font-mono text-[10px] tracking-[0.04em] text-[#736a58]">
            {caption}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function VoiceBubble({
  duration,
  tone = "light",
}: {
  duration: string;
  tone?: "light" | "dark";
}) {
  const fillBars = [3, 5, 8, 12, 6, 10, 4, 7, 9, 5, 3, 8, 11, 6, 4, 7];
  const isDark = tone === "dark";
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full ${
          isDark ? "bg-white/15 text-white" : "bg-[#2d3436]/10 text-[#2d3436]"
        }`}
      >
        <svg
          viewBox="0 0 12 12"
          className="size-3"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M3 2.5v7l6-3.5z" />
        </svg>
      </span>
      <div className="flex items-end gap-0.5" aria-hidden="true">
        {fillBars.map((h, i) => (
          <span
            key={i}
            style={{ height: `${h}px` }}
            className={`w-0.5 rounded-full ${isDark ? "bg-white/70" : "bg-[#2d3436]/55"}`}
          />
        ))}
      </div>
      <span
        className={`shrink-0 text-[11px] tabular-nums ${
          isDark ? "text-white/80" : "text-[#2d3436]/70"
        }`}
      >
        {duration}
      </span>
    </div>
  );
}

export function ImagePreview({
  alt,
  caption,
}: {
  alt: string;
  caption?: string;
}) {
  return (
    <div
      role="img"
      aria-label={alt}
      className="flex flex-col gap-1.5 overflow-hidden rounded-lg"
    >
      <div
        aria-hidden="true"
        className="relative h-[88px] w-full bg-gradient-to-br from-[#3a4a1e] via-[#5a6e32] to-[#c4a882]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.18),transparent_55%)]"
        />
      </div>
      {caption ? (
        <p className="font-mono text-[10px] tracking-[0.04em] text-[#736a58]">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

export type EmailMockProps = {
  from: string;
  subject: string;
  body: ReactNode;
};

export function EmailMock({ from, subject, body }: EmailMockProps) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>Email</p>
        <span aria-hidden="true" className={HEADER_META}>
          now
        </span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5 border-b border-[#2d3436]/8 pb-3">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] tracking-[0.12em] text-[#a39684] uppercase">
              From
            </span>
            <span className="truncate text-[12.5px] text-[#2d3436]">
              {from}
            </span>
          </div>
          <p className="font-serif text-[15px] font-semibold leading-[1.25] text-[#2d3436]">
            {subject}
          </p>
        </div>
        <div className="text-[12.5px] leading-[1.5] text-[#4d453b]">
          {body}
        </div>
      </div>
    </div>
  );
}
