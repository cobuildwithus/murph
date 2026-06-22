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
          className="relative grid size-[62px] shrink-0 grid-cols-3 gap-[5px] rounded-[14px] border border-[#2d3436]/12 bg-[#1f241c] p-2.5 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.25)]"
        >
          {Array.from({ length: 9 }).map((_, index) => (
            <span
              key={index}
              className={`size-2 rounded-full ${
                index === 4 ? "bg-[#83945f]" : "bg-[#c4a882]/85"
              }`}
            />
          ))}
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
