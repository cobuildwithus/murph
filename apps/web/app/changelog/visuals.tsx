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
      className="overflow-hidden rounded-2xl rounded-bl-md border border-[#2d3436]/8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <div
        aria-hidden="true"
        className="relative aspect-[4/3] w-full bg-gradient-to-br from-[#3a4a1e] via-[#5a6e32] to-[#c4a882]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.22),transparent_55%)]"
        />
      </div>
      {caption ? (
        <p className="bg-[#fafaf6] px-3 py-1.5 font-mono text-[10px] tracking-[0.04em] text-[#736a58]">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

export type ScheduleEntry = {
  day: string;
  time: string;
  what: string;
};

export type PreferenceEntry = {
  label: string;
  note?: string;
  value: string;
};

export function PreferenceCard({
  entries,
  label = "Murph settings",
  meta,
}: {
  entries: readonly PreferenceEntry[];
  label?: string;
  meta?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
        {meta ? <span className={HEADER_META}>{meta}</span> : null}
      </div>
      <div className="flex flex-col divide-y divide-[#2d3436]/8">
        {entries.map((entry) => (
          <div
            key={entry.label}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-[#2d3436]">
                {entry.label}
              </p>
              {entry.note ? (
                <p className="mt-0.5 text-[10.5px] leading-[1.4] text-[#736a58]">
                  {entry.note}
                </p>
              ) : null}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#3a4a1e]/15 bg-[#3a4a1e]/8 px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.04em] text-[#3a4a1e]">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#5a6e32]" />
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarMock({
  entries,
  label = "Weekly cadence",
}: {
  entries: readonly ScheduleEntry[];
  label?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex flex-col divide-y divide-[#2d3436]/8">
        {entries.map((entry, index) => (
          <div
            key={index}
            className="flex items-baseline gap-3 px-4 py-2.5 text-[12.5px]"
          >
            <span className="w-9 shrink-0 font-mono text-[11px] tracking-[0.06em] text-[#736a58] uppercase">
              {entry.day}
            </span>
            <span className="w-16 shrink-0 font-mono tabular-nums text-[#2d3436]">
              {entry.time}
            </span>
            <span className="min-w-0 flex-1 truncate text-[#4d453b]">
              {entry.what}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricCardMock({
  caption,
  delta,
  label,
  sparkline,
  title,
  value,
}: {
  caption?: string;
  delta?: { direction: "up" | "down"; text: string };
  label: string;
  sparkline: readonly number[];
  title: string;
  value: string;
}) {
  const isUp = delta?.direction === "up";
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="font-serif text-[15px] font-semibold leading-tight text-[#2d3436]">
          {title}
        </p>
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[1.85rem] font-semibold leading-none text-[#3a4a1e] tabular-nums">
              {value}
            </span>
            {delta ? (
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  isUp ? "text-[#3a4a1e]" : "text-[#a36b3f]"
                }`}
              >
                {isUp ? "↑" : "↓"} {delta.text}
              </span>
            ) : null}
          </div>
          <Sparkline values={sparkline} />
        </div>
        {caption ? (
          <p className="font-mono text-[10.5px] tracking-[0.04em] text-[#736a58]">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: readonly number[] }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const width = 64;
  const height = 22;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`,
    )
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[22px] w-[64px]"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="#5a6e32"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export type DeviceStatus = "connected" | "reconnect" | "syncing";

export type DeviceEntry = {
  color: string;
  initial: string;
  name: string;
  status: DeviceStatus;
};

export function DeviceList({
  devices,
  label = "Wearables",
}: {
  devices: readonly DeviceEntry[];
  label?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex flex-col divide-y divide-[#2d3436]/8">
        {devices.map((device) => (
          <div
            key={device.name}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
              style={{ backgroundColor: device.color }}
            >
              {device.initial}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#2d3436]">
              {device.name}
            </span>
            <DeviceStatusBadge status={device.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#3a4a1e]/8 px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-[#3a4a1e]">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[#5a6e32]" />
        Connected
      </span>
    );
  }
  if (status === "syncing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#c4a882]/15 px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-[#736a58]">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[#a39684]" />
        Syncing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#a36b3f]/12 px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-[#8b4f2c]">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[#a36b3f]" />
      Reconnect
    </span>
  );
}

export type ChecklistItem = {
  done: boolean;
  label: string;
};

export function ChecklistMock({
  items,
  label = "Next steps",
}: {
  items: readonly ChecklistItem[];
  label?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${
                item.done
                  ? "border-[#3a4a1e] bg-[#3a4a1e] text-[#f5f0e8]"
                  : "border-[#c4a882]/60 bg-transparent text-transparent"
              }`}
            >
              <svg
                viewBox="0 0 12 12"
                className="size-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path
                  d="M2.5 6.5l2.5 2.5L9.5 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[12.5px] ${
                item.done ? "text-[#736a58]" : "text-[#2d3436]"
              }`}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type MealMacros = {
  carbs: number;
  fat: number;
  protein: number;
};

export function MealCard({
  calories,
  label = "Meal",
  macros,
  source,
  time,
  title,
}: {
  calories: number;
  label?: string;
  macros: MealMacros;
  source?: string;
  time: string;
  title: string;
}) {
  const total = macros.protein + macros.carbs + macros.fat || 1;
  const proteinPct = (macros.protein / total) * 100;
  const carbsPct = (macros.carbs / total) * 100;
  const fatPct = (macros.fat / total) * 100;

  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
        {source ? <span className={HEADER_META}>via {source}</span> : null}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-serif text-[15px] font-semibold leading-tight text-[#2d3436]">
            {title}
          </p>
          <span className="font-mono text-[10px] tracking-[0.06em] text-[#736a58] uppercase">
            {time}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[1.6rem] font-semibold leading-none tabular-nums text-[#3a4a1e]">
            {calories}
          </span>
          <span className="font-mono text-[10.5px] tracking-[0.06em] text-[#736a58] uppercase">
            cal
          </span>
        </div>
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#2d3436]/8">
          <span
            aria-hidden="true"
            style={{ width: `${proteinPct}%` }}
            className="bg-[#3a4a1e]"
          />
          <span
            aria-hidden="true"
            style={{ width: `${carbsPct}%` }}
            className="bg-[#c4a882]"
          />
          <span
            aria-hidden="true"
            style={{ width: `${fatPct}%` }}
            className="bg-[#a36b3f]"
          />
        </div>
        <div className="flex items-center gap-3 font-mono text-[10.5px] tabular-nums text-[#736a58]">
          <span>
            <strong className="font-semibold text-[#2d3436]">P</strong>{" "}
            {macros.protein}g
          </span>
          <span>
            <strong className="font-semibold text-[#2d3436]">C</strong>{" "}
            {macros.carbs}g
          </span>
          <span>
            <strong className="font-semibold text-[#2d3436]">F</strong>{" "}
            {macros.fat}g
          </span>
        </div>
      </div>
    </div>
  );
}

export function AppIconCard({
  label = "iOS app",
  name = "Murph",
  status,
}: {
  label?: string;
  name?: string;
  status: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex items-center gap-4 p-5">
        <div
          aria-hidden="true"
          className="relative flex size-[62px] shrink-0 items-center justify-center rounded-[14px] border border-[#2d3436]/12 bg-[#1f241c] p-[9px] shadow-[0_2px_8px_-4px_rgba(0,0,0,0.25)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/murph-mark.svg"
            alt=""
            className="h-auto w-full"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-serif text-[1.05rem] font-semibold leading-tight text-[#2d3436]">
            {name}
          </p>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#c4a882]/15 px-2 py-0.5 font-mono text-[10px] tracking-[0.06em] text-[#736a58]">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-[#a39684]"
            />
            {status}
          </span>
        </div>
      </div>
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

export function SongBubble({
  duration,
  title,
  artist = "Murph",
  tone = "light",
}: {
  artist?: string;
  duration: string;
  title: string;
  tone?: "light" | "dark";
}) {
  const isDark = tone === "dark";
  return (
    <div
      className={`flex w-full max-w-[260px] flex-col gap-1.5 ${
        isDark ? "text-[#f5f0e8]" : "text-[#2d3436]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md ${
            isDark
              ? "bg-white/15 text-white"
              : "bg-gradient-to-br from-[#3a4a1e] to-[#5a6e32] text-white"
          }`}
        >
          <svg
            viewBox="0 0 12 12"
            className="size-3.5"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M10 1.8L5 3.1v5.6a1.5 1.5 0 1 1-1-1.4V4L10 2.4V1.8z" />
            <ellipse cx="3.6" cy="9" rx="1.6" ry="1.2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[12.5px] font-semibold leading-tight ${
              isDark ? "text-white" : "text-[#2d3436]"
            }`}
          >
            {title}
          </p>
          <p
            className={`mt-0.5 truncate font-mono text-[10px] tracking-[0.06em] ${
              isDark ? "text-white/65" : "text-[#736a58]"
            }`}
          >
            {artist} · {duration}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full ${
            isDark ? "bg-white/15 text-white" : "bg-[#2d3436]/10 text-[#2d3436]"
          }`}
        >
          <svg
            viewBox="0 0 12 12"
            className="size-2.5"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M3 2.5v7l6-3.5z" />
          </svg>
        </span>
        <div className="flex items-end gap-0.5" aria-hidden="true">
          {[2, 4, 7, 9, 5, 8, 11, 6, 4, 7, 10, 5, 3, 6, 9, 4, 2].map((h, i) => (
            <span
              key={i}
              style={{ height: `${h}px` }}
              className={`w-0.5 rounded-full ${
                isDark ? "bg-white/70" : "bg-[#2d3436]/55"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ApprovalCard({
  action,
  detail,
  cta = "Approve with passkey",
}: {
  action: string;
  cta?: string;
  detail?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>Approval requested</p>
        <span className={HEADER_META}>expires in 5 min</span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[#3a4a1e]/15 bg-[#3a4a1e]/8 text-[#3a4a1e]"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 1.5l5 2v3.5c0 3-2 5.5-5 6.5-3-1-5-3.5-5-6.5V3.5l5-2z" />
              <path d="M5.5 8l1.8 1.8L10.5 6.5" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-serif text-[14.5px] font-semibold leading-tight text-[#2d3436]">
              {action}
            </p>
            {detail ? (
              <p className="mt-1 text-[12px] leading-[1.5] text-[#736a58]">
                {detail}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#3a4a1e] px-3 py-1.5 text-[12px] font-medium text-[#f5f0e8]">
            <svg
              viewBox="0 0 16 16"
              className="size-3"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="8" cy="6" r="3" />
              <path d="M8 9.5c-2.6 0-4.5 1.5-4.5 3.5h9c0-2-1.9-3.5-4.5-3.5z" />
            </svg>
            {cta}
          </span>
          <span className="inline-flex items-center justify-center rounded-full border border-[#c4a882]/45 px-3 py-1.5 text-[12px] font-medium text-[#736a58]">
            Deny
          </span>
        </div>
      </div>
    </div>
  );
}

export function PdfPreview({
  title,
  meta,
  lines = 6,
}: {
  lines?: number;
  meta?: string;
  title: string;
}) {
  const lineWidths = ["100%", "94%", "88%", "97%", "82%", "92%", "90%", "75%"];
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>PDF document</p>
        {meta ? <span className={HEADER_META}>{meta}</span> : null}
      </div>
      <div className="bg-[#ece6d6] p-4">
        <div className="relative overflow-hidden rounded-md border border-[#2d3436]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_16px_-12px_rgba(45,52,54,0.25)]">
          <div className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-sm bg-[#a36b3f] px-1.5 py-0.5 font-mono text-[8px] font-semibold tracking-[0.12em] text-white uppercase">
            PDF
          </div>
          <div className="flex flex-col gap-2 px-5 py-5">
            <p className="font-serif text-[13px] font-semibold leading-tight text-[#2d3436]">
              {title}
            </p>
            <span
              aria-hidden="true"
              className="h-px w-8 bg-[#3a4a1e]/40"
            />
            <div className="mt-1 flex flex-col gap-1.5" aria-hidden="true">
              {Array.from({ length: lines }).map((_, i) => (
                <span
                  key={i}
                  style={{ width: lineWidths[i % lineWidths.length] }}
                  className="block h-1.5 rounded-sm bg-[#2d3436]/12"
                />
              ))}
            </div>
            <div
              aria-hidden="true"
              className="mt-3 grid grid-cols-3 gap-1.5"
            >
              <span className="h-6 rounded-sm bg-[#3a4a1e]/20" />
              <span className="h-6 rounded-sm bg-[#c4a882]/35" />
              <span className="h-6 rounded-sm bg-[#a36b3f]/25" />
            </div>
            <div className="mt-2 flex flex-col gap-1" aria-hidden="true">
              <span className="block h-1.5 w-[80%] rounded-sm bg-[#2d3436]/12" />
              <span className="block h-1.5 w-[60%] rounded-sm bg-[#2d3436]/12" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type RetentionEvent = {
  day: number;
  label: string;
  tone?: "neutral" | "warn" | "expire";
};

export function AssessmentCard({
  topic,
  assessment,
  nextAction,
  rationale,
  meta,
}: {
  assessment: string;
  meta?: string;
  nextAction: string;
  rationale?: string;
  topic: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{topic}</p>
        {meta ? <span className={HEADER_META}>{meta}</span> : null}
      </div>
      <div className="flex flex-col">
        <div className="flex flex-col gap-1.5 border-b border-[#2d3436]/8 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-[#736a58]"
            />
            <p className="font-mono text-[9.5px] font-medium tracking-[0.14em] text-[#736a58] uppercase">
              Best read
            </p>
          </div>
          <p className="text-[12.5px] leading-[1.55] text-[#2d3436]">
            {assessment}
          </p>
        </div>
        <div className="relative flex flex-col gap-1.5 bg-[#3a4a1e]/[0.05] px-4 py-3.5">
          <span
            aria-hidden="true"
            className="absolute left-0 top-3 h-[calc(100%-1.5rem)] w-[2px] rounded-r-full bg-[#3a4a1e]"
          />
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-[#3a4a1e]"
            />
            <p className="font-mono text-[9.5px] font-medium tracking-[0.14em] text-[#3a4a1e] uppercase">
              Recommended next
            </p>
          </div>
          <p className="font-serif text-[13.5px] font-semibold leading-snug text-[#2d3436]">
            {nextAction}
          </p>
          {rationale ? (
            <p className="text-[11.5px] leading-[1.45] text-[#736a58]">
              {rationale}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type ReasoningStep = {
  label: string;
  note?: string;
  state: "done" | "active" | "pending";
};

export function ReasoningSteps({
  steps,
  label = "Clinical-style reasoning",
  meta,
}: {
  label?: string;
  meta?: string;
  steps: readonly ReasoningStep[];
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
        {meta ? <span className={HEADER_META}>{meta}</span> : null}
      </div>
      <div className="flex flex-col px-4 py-3.5">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const isDone = step.state === "done";
          const isActive = step.state === "active";
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[9.5px] font-semibold tabular-nums ${
                    isDone
                      ? "bg-[#3a4a1e] text-[#f5f0e8]"
                      : isActive
                        ? "border-2 border-[#3a4a1e] bg-[#fffcf6] text-[#3a4a1e]"
                        : "border border-[#c4a882]/55 bg-transparent text-[#a39684]"
                  }`}
                >
                  {isDone ? (
                    <svg
                      viewBox="0 0 12 12"
                      className="size-2.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2.5 6.5l2.5 2.5L9.5 4" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    style={{ minHeight: step.note ? "28px" : "16px" }}
                    className={`mt-0.5 w-px flex-1 ${
                      isDone ? "bg-[#3a4a1e]/35" : "bg-[#c4a882]/45"
                    }`}
                  />
                ) : null}
              </div>
              <div
                className={`flex flex-col gap-0.5 ${isLast ? "pb-0" : "pb-3"}`}
              >
                <p
                  className={`text-[12.5px] leading-tight ${
                    isActive
                      ? "font-semibold text-[#2d3436]"
                      : isDone
                        ? "text-[#736a58]"
                        : "text-[#a39684]"
                  }`}
                >
                  {step.label}
                </p>
                {step.note ? (
                  <p className="text-[11px] leading-[1.45] text-[#736a58]">
                    {step.note}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type RegimenEntry = {
  kind: "goal" | "habit" | "ramp";
  text: string;
};

export function GoalsRegimenCard({
  entries,
  label = "Pinned for this thread",
  meta = "read each turn",
}: {
  entries: readonly RegimenEntry[];
  label?: string;
  meta?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <div className="flex items-center gap-1.5">
          <svg
            viewBox="0 0 12 12"
            className="size-2.5 text-[#a36b3f]"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5.6 1.6l1.4 2.7 3 .4-2.2 2.1.6 3-2.8-1.4-2.8 1.4.6-3L1.2 4.7l3-.4z" />
          </svg>
          <p className={HEADER_LABEL}>{label}</p>
        </div>
        {meta ? <span className={HEADER_META}>{meta}</span> : null}
      </div>
      <div className="flex flex-col divide-y divide-[#2d3436]/8">
        {entries.map((entry, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]"
          >
            <span
              className={`inline-flex w-12 shrink-0 justify-center rounded-full px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.1em] uppercase ${
                entry.kind === "goal"
                  ? "bg-[#3a4a1e]/12 text-[#3a4a1e]"
                  : entry.kind === "habit"
                    ? "bg-[#c4a882]/25 text-[#736a58]"
                    : "bg-[#a36b3f]/15 text-[#8b4f2c]"
              }`}
            >
              {entry.kind}
            </span>
            <span className="min-w-0 flex-1 truncate text-[#2d3436]">
              {entry.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type ExerciseTile = {
  hue: number;
  name: string;
  reps?: string;
};

export function ExerciseGrid({
  tiles,
  caption,
}: {
  caption?: string;
  tiles: readonly ExerciseTile[];
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>A few to start with</p>
        <span className={HEADER_META}>
          {tiles.length} {tiles.length === 1 ? "movement" : "movements"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3.5">
        {tiles.map((tile, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div
              aria-hidden="true"
              className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-[#2d3436]/10 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
              style={{
                background: `linear-gradient(155deg, hsl(${tile.hue} 26% 32%) 0%, hsl(${tile.hue} 32% 56%) 65%, hsl(${tile.hue} 35% 78%) 100%)`,
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(circle_at_28%_22%,rgba(255,255,255,0.32),transparent_58%)]"
              />
              <ExerciseGlyph index={i} />
              <span
                aria-hidden="true"
                className="absolute left-1.5 top-1.5 inline-flex size-[15px] items-center justify-center rounded-full bg-black/25 font-mono text-[8.5px] font-semibold text-white tabular-nums backdrop-blur-[2px]"
              >
                {i + 1}
              </span>
            </div>
            <div className="flex flex-col gap-0">
              <p className="truncate text-[11px] font-semibold leading-tight text-[#2d3436]">
                {tile.name}
              </p>
              {tile.reps ? (
                <p className="truncate font-mono text-[9.5px] tracking-[0.04em] text-[#736a58] tabular-nums">
                  {tile.reps}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {caption ? (
        <div className="border-t border-[#2d3436]/8 px-4 py-2.5">
          <p className="text-center text-[11.5px] italic leading-tight text-[#4d453b]">
            &ldquo;{caption}&rdquo;
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ExerciseGlyph({ index }: { index: number }) {
  const glyphs = [
    <g key="breath">
      <circle cx="50" cy="44" r="13" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <circle cx="50" cy="44" r="20" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.35" />
      <circle cx="50" cy="44" r="27" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.22" />
      <circle cx="50" cy="44" r="3" fill="currentColor" />
    </g>,
    <g key="bridge">
      <path d="M20 56 Q50 24 80 56" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
      <line x1="20" y1="56" x2="20" y2="64" stroke="currentColor" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
      <line x1="80" y1="56" x2="80" y2="64" stroke="currentColor" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
      <circle cx="50" cy="36" r="2" fill="currentColor" opacity="0.85" />
    </g>,
    <g key="reach">
      <line x1="50" y1="22" x2="50" y2="58" stroke="currentColor" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
      <line x1="50" y1="32" x2="70" y2="20" stroke="currentColor" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
      <line x1="50" y1="32" x2="34" y2="42" stroke="currentColor" strokeWidth="1.4" opacity="0.5" strokeLinecap="round" />
      <line x1="50" y1="58" x2="42" y2="72" stroke="currentColor" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
      <line x1="50" y1="58" x2="58" y2="72" stroke="currentColor" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
      <circle cx="50" cy="18" r="3" fill="currentColor" opacity="0.85" />
    </g>,
  ];
  return (
    <svg
      viewBox="0 0 100 80"
      className="absolute inset-x-0 bottom-0 h-full w-full text-white"
      aria-hidden="true"
    >
      {glyphs[index % glyphs.length]}
    </svg>
  );
}

export function PrivacyTimeline({
  events,
  span = 14,
  label = "Privacy retention",
  caption,
}: {
  caption?: string;
  events: readonly RetentionEvent[];
  label?: string;
  span?: number;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
        <span className={HEADER_META}>{span}-day window</span>
      </div>
      <div className="flex flex-col gap-4 px-5 pt-5 pb-4">
        <div className="relative" aria-hidden="true">
          <div className="absolute inset-x-0 top-[7px] h-px bg-gradient-to-r from-[#3a4a1e]/45 via-[#c4a882]/45 to-[#a36b3f]/55" />
          <div className="relative flex justify-between">
            {events.map((event, i) => {
              const isExpire = event.tone === "expire";
              const isWarn = event.tone === "warn";
              return (
                <div key={i} className="flex flex-col items-center gap-2">
                  <span
                    className={`inline-flex size-[15px] items-center justify-center rounded-full border-2 ${
                      isExpire
                        ? "border-[#a36b3f] bg-[#a36b3f]/15"
                        : isWarn
                          ? "border-[#c4a882] bg-[#c4a882]/15"
                          : "border-[#3a4a1e] bg-[#fffcf6]"
                    }`}
                  >
                    {isExpire ? (
                      <span className="size-[5px] rounded-full bg-[#a36b3f]" />
                    ) : (
                      <span className="size-[5px] rounded-full bg-[#3a4a1e]" />
                    )}
                  </span>
                  <span className="font-mono text-[9.5px] tracking-[0.06em] text-[#736a58] tabular-nums uppercase">
                    Day {event.day}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col divide-y divide-[#2d3436]/8">
          {events.map((event, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-3 py-1.5"
            >
              <span className="font-mono text-[10.5px] tracking-[0.06em] text-[#736a58] tabular-nums uppercase">
                Day {event.day}
              </span>
              <span
                className={`text-right text-[12px] leading-tight ${
                  event.tone === "expire"
                    ? "font-semibold text-[#8b4f2c]"
                    : "text-[#2d3436]"
                }`}
              >
                {event.label}
              </span>
            </div>
          ))}
        </div>
        {caption ? (
          <p className="font-mono text-[10.5px] tracking-[0.04em] text-[#736a58]">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export type DialogChoice = {
  label: string;
  note?: string;
};

export function DialogMock({
  body,
  choices,
  label = "Murph",
  media,
  primary,
  secondary,
  title,
}: {
  body?: string;
  choices?: readonly DialogChoice[];
  label?: string;
  media?: ReactNode;
  primary: string;
  secondary?: string;
  title: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="font-serif text-[15px] font-semibold leading-tight text-[#2d3436]">
          {title}
        </p>
        {body ? (
          <p className="text-[12.5px] leading-[1.5] text-[#4d453b]">{body}</p>
        ) : null}
        {media ? <div className="py-0.5">{media}</div> : null}
        {choices && choices.length > 0 ? (
          <div className="flex flex-col divide-y divide-[#2d3436]/8 rounded-xl border border-[#2d3436]/8">
            {choices.map((choice) => (
              <div
                key={choice.label}
                className="flex items-baseline justify-between gap-3 px-3 py-2"
              >
                <span className="text-[12.5px] font-medium text-[#2d3436]">
                  {choice.label}
                </span>
                {choice.note ? (
                  <span className="font-mono text-[10px] tracking-[0.04em] text-[#736a58]">
                    {choice.note}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-2 pt-0.5">
          <span className="inline-flex items-center justify-center rounded-full bg-[#3a4a1e] px-3 py-2 text-[12.5px] font-medium text-[#f5f0e8]">
            {primary}
          </span>
          {secondary ? (
            <span className="inline-flex items-center justify-center rounded-full border border-[#c4a882]/45 px-3 py-2 text-[12.5px] font-medium text-[#736a58]">
              {secondary}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type ContactField = {
  label: string;
  value: string;
};

export function ContactCardMock({
  action,
  avatarSrc,
  fields,
  label = "Contact card",
  name = "Murph",
  subtitle,
}: {
  action?: string;
  avatarSrc?: string;
  fields: readonly ContactField[];
  label?: string;
  name?: string;
  subtitle?: string;
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
        <span className={HEADER_META}>vCard</span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          {avatarSrc ? (
            // The changelog study uses a public synthetic brand portrait only.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="size-11 shrink-0 rounded-full border border-[#2d3436]/10 object-cover"
              src={avatarSrc}
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#3a4a1e] font-serif text-[17px] font-semibold text-[#f5f0e8]"
            >
              {name.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-serif text-[15px] font-semibold leading-tight text-[#2d3436]">
              {name}
            </p>
            {subtitle ? (
              <p className="mt-0.5 text-[11px] leading-[1.4] text-[#736a58]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col divide-y divide-[#2d3436]/8 border-t border-[#2d3436]/8">
          {fields.map((field) => (
            <div
              key={field.label}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <span className="font-mono text-[10px] tracking-[0.12em] text-[#a39684] uppercase">
                {field.label}
              </span>
              <span className="truncate text-[12.5px] text-[#2d3436] tabular-nums">
                {field.value}
              </span>
            </div>
          ))}
        </div>
        {action ? (
          <span className="inline-flex items-center justify-center rounded-full bg-[#3a4a1e] px-3 py-1.5 text-[12px] font-medium text-[#f5f0e8]">
            {action}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export type PanelEntry = {
  state: "ok" | "retry";
  title: string;
  value?: string;
};

export function PanelGrid({
  label = "Home",
  panels,
}: {
  label?: string;
  panels: readonly PanelEntry[];
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3.5">
        {panels.map((panel) => {
          const isRetry = panel.state === "retry";
          return (
            <div
              key={panel.title}
              className={`flex min-h-[64px] flex-col justify-between gap-1.5 rounded-xl border p-2.5 ${
                isRetry
                  ? "border-dashed border-[#c4a882]/70 bg-[#c4a882]/8"
                  : "border-[#2d3436]/8 bg-[#fafaf6]"
              }`}
            >
              <p className="text-[11px] leading-tight font-medium text-[#2d3436]">
                {panel.title}
              </p>
              {isRetry ? (
                <span className="inline-flex w-fit items-center rounded-full border border-[#c4a882]/60 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.06em] text-[#8b4f2c] uppercase">
                  Try again
                </span>
              ) : (
                <p className="font-serif text-[17px] leading-none font-semibold text-[#3a4a1e] tabular-nums">
                  {panel.value}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type CompactTableColumn = {
  key: string;
  label: string;
};

export type CompactTableRow = Readonly<Record<string, string>>;

export function CompactTableMock({
  columns,
  label = "Murph table",
  rows,
}: {
  columns: readonly CompactTableColumn[];
  label?: string;
  rows: readonly CompactTableRow[];
}) {
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
        <span className={HEADER_META}>{rows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#2d3436]/8 bg-[#fafaf6]">
              {columns.map((column) => (
                <th
                  className="px-3 py-2 font-mono text-[9.5px] font-medium tracking-[0.08em] text-[#736a58] uppercase"
                  key={column.key}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2d3436]/8">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column, columnIndex) => (
                  <td
                    className={`px-3 py-2.5 text-[12px] text-[#4d453b] ${
                      columnIndex === 0 ? "font-medium text-[#2d3436]" : ""
                    }`}
                    key={column.key}
                  >
                    {row[column.key] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReferenceBandMock({
  highLabel,
  label = "Reference context",
  lowLabel,
  markerLabel,
  markerPosition,
}: {
  highLabel: string;
  label?: string;
  lowLabel: string;
  markerLabel: string;
  markerPosition: number;
}) {
  const boundedPosition = Math.min(100, Math.max(0, markerPosition));
  return (
    <div className={FRAME_BASE}>
      <div className={FRAME_HEADER}>
        <p className={HEADER_LABEL}>{label}</p>
      </div>
      <div
        aria-label={`${markerLabel}, reference range ${lowLabel} to ${highLabel}`}
        className="p-4"
        role="img"
      >
        <div className="relative pt-8">
          <div
            className="absolute top-0 -translate-x-1/2 text-center"
            style={{ left: `${boundedPosition}%` }}
          >
            <p className="font-serif text-[15px] font-semibold leading-none text-[#2d3436]">
              {markerLabel}
            </p>
            <span
              aria-hidden="true"
              className="mx-auto mt-1 block h-3 w-px bg-[#2d3436]"
            />
          </div>
          <div className="grid h-3 grid-cols-[1fr_2fr_1fr] overflow-hidden rounded-full border border-[#2d3436]/10">
            <span aria-hidden="true" className="bg-[#a36b3f]/18" />
            <span aria-hidden="true" className="bg-[#5a6e32]/25" />
            <span aria-hidden="true" className="bg-[#a36b3f]/18" />
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] tracking-[0.04em] text-[#736a58]">
            <span>{lowLabel}</span>
            <span>{highLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
