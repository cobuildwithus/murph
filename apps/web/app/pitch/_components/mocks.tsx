"use client";

import type { ReactNode } from "react";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pitch deck mocks — the illustrative visuals dropped into slides:
   chat threads, stat cards, diagrams, and the positioning chart.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ FLOW CONNECTOR ━━━━━━━━━━━━━━━━━━━━━━ */

// Stage joiner for the product flow: points right between columns on
// wide screens, down between stacked cards on narrow ones.
export function FlowConnector() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center text-lg text-[#7a8c6e]"
    >
      <span className="lg:hidden">&darr;</span>
      <span className="hidden lg:inline">&rarr;</span>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ CHAT MOCK ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export type ChatMessage = {
  kind: "you" | "murph" | "friend";
  name?: string;
  text: string;
};

// The chat card fill, reused by the bubble tails to carve their curl.
const CHAT_CARD_FILL = "#fffcf6";

// Sent-bubble ("you") treatments. "blue" is the literal iMessage cue;
// "slate" is a desaturated, palette-friendly take; "dark" is shape-only.
export type SentBubble = "dark" | "blue" | "slate";
const SENT_FILLS: Record<SentBubble, string> = {
  dark: "#2d3436",
  blue: "#0a84ff",
  slate: "#5b7a99",
};

export function ChatMock({
  title,
  members,
  messages,
  sentBubble = "dark",
}: {
  title: string;
  members: number;
  messages: readonly ChatMessage[];
  // Fill treatment for the sender's bubbles — see SentBubble.
  sentBubble?: SentBubble;
}) {
  const sentFill = SENT_FILLS[sentBubble];
  return (
    <div
      className="rounded-[22px] border border-[#c4a882]/30 p-4"
      style={{ backgroundColor: CHAT_CARD_FILL }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-[#c4a882]/25 px-2 pb-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#7a8c6e]/20 font-mono text-[10px] font-semibold uppercase text-[#5a6e32]">
          {title.slice(0, 2)}
        </span>
        <div>
          <p className="text-[13px] font-semibold leading-tight text-[#2d3436]">
            {title}
          </p>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
            {members} members
          </p>
        </div>
      </div>
      {/* Messages */}
      <div className="flex flex-col px-2 pt-3">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const sameAsPrevious =
            previous?.kind === message.kind &&
            previous?.name === message.name;
          const sameAsNext =
            next?.kind === message.kind && next?.name === message.name;
          return (
            <ChatBubble
              key={index}
              message={message}
              sentFill={sentFill}
              firstOfGroup={!sameAsPrevious}
              lastOfGroup={!sameAsNext}
              stacked={index > 0}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  sentFill,
  firstOfGroup,
  lastOfGroup,
  stacked,
}: {
  message: ChatMessage;
  sentFill: string;
  firstOfGroup: boolean;
  lastOfGroup: boolean;
  stacked: boolean;
}) {
  const mine = message.kind === "you";
  const fill =
    message.kind === "you"
      ? sentFill
      : message.kind === "murph"
        ? "#e4e8df"
        : "#ece3d2";

  return (
    <div className={firstOfGroup && stacked ? "mt-2.5" : "mt-[3px]"}>
      {firstOfGroup && !mine ? (
        <p className="mb-1 flex items-center gap-1.5 pl-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[#736a58]">
          {message.kind === "murph" ? (
            <span className="size-1.5 rounded-full bg-[#5a6e32]" />
          ) : null}
          {message.kind === "murph" ? "Murph" : message.name}
        </p>
      ) : null}
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div
          className={`relative w-fit max-w-[80%] rounded-[18px] px-3.5 py-2 text-sm leading-[1.35] ${
            mine ? "mr-2.5 text-[#f5f0e8]" : "ml-2.5 text-[#2d3436]"
          } ${
            // Square the tail-side bottom corner so the tail blob merges
            // cleanly instead of clashing with a rounded corner.
            lastOfGroup
              ? mine
                ? "rounded-br-[7px]"
                : "rounded-bl-[7px]"
              : ""
          }`}
          style={{ backgroundColor: fill }}
        >
          {lastOfGroup ? (
            <>
              {/* Tail fill — bubble-colored blob that pokes out the corner */}
              <span
                aria-hidden="true"
                className={`absolute bottom-[-2px] h-[25px] w-[20px] ${
                  mine
                    ? "right-[-8px] rounded-bl-[16px]"
                    : "left-[-7px] rounded-br-[16px]"
                }`}
                style={{ backgroundColor: fill }}
              />
              {/* Tail cutout — card-colored shape that carves the curl */}
              <span
                aria-hidden="true"
                className={`absolute bottom-[-2px] h-[25px] w-[26px] ${
                  mine
                    ? "right-[-26px] rounded-bl-[10px]"
                    : "left-[-26px] rounded-br-[10px]"
                }`}
                style={{ backgroundColor: CHAT_CARD_FILL }}
              />
            </>
          ) : null}
          <span className="relative">{message.text}</span>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ STAT CARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function StatCard({
  value,
  label,
  source,
}: {
  value: string;
  label: string;
  source?: string;
}) {
  return (
    <div className="rounded-xl border border-[#c4a882]/25 bg-[#fffcf6]/90 p-5">
      <p className="font-serif text-[2.4rem] font-semibold leading-none tracking-[-0.03em] text-[#2d3436]">
        {value}
      </p>
      <p className="mt-2.5 text-[13px] leading-[1.5] text-[#635a48]">{label}</p>
      {source ? (
        <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]/70">
          Source: {source}
        </p>
      ) : null}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ PIVOT CARD ━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function PivotCard({
  label,
  title,
  items,
  highlight,
}: {
  label: string;
  title: string;
  items: readonly string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-6 ${
        highlight
          ? "border-[#5a6e32]/35 bg-[#5a6e32]/[0.07]"
          : "border-[#c4a882]/25 bg-[#fffcf6]/90"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#736a58]">
        {label}
      </p>
      <p
        className={`mt-1.5 font-serif text-xl font-semibold ${
          highlight ? "text-[#5a6e32]" : "text-[#2d3436]"
        }`}
      >
        {title}
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-2.5 text-[14px] leading-[1.5] text-[#635a48]"
          >
            <span className="mt-0.5 text-[#5a6e32]">&middot;</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ MURPH LOOP ━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// Slide 08: the product loop. Every source feeds a private health
// vault you can chat with, which powers habit coordination, which
// teaches Murph what works — for you and for people like you.
const MURPH_LOOP = [
  {
    title: "Connect every source",
    detail: "Wearables · labs · meals · symptoms · manual check-ins",
  },
  {
    title: "Build your health vault",
    detail: "Baselines · protocols · outcomes · confounders · history",
  },
  {
    title: "Chat with Murph anywhere",
    detail: "iMessage · WhatsApp · Telegram · email",
  },
  {
    title: "Coordinate healthy habits",
    detail: "Challenges · reminders · leaderboards · results",
  },
  {
    title: "Learn what works",
    detail: "For you, your friends, and people like you",
  },
] as const;

export function MurphLoop() {
  return (
    <div className="rounded-xl border border-[#c4a882]/30 bg-[#fffcf6]/90 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#5a6e32]">
        The Murph loop
      </p>
      <div className="mt-4 flex flex-col">
        {MURPH_LOOP.map((stage, index) => {
          const last = index === MURPH_LOOP.length - 1;
          return (
            <div key={stage.title}>
              <div
                className={`rounded-lg border px-3.5 py-2.5 ${
                  last
                    ? "border-[#5a6e32]/40 bg-[#5a6e32]/[0.08]"
                    : "border-[#c4a882]/30 bg-[#f3ead9]/45"
                }`}
              >
                <p className="text-[13px] font-semibold text-[#2d3436]">
                  {stage.title}
                </p>
                <p className="mt-0.5 text-[11px] leading-[1.45] text-[#736a58]">
                  {stage.detail}
                </p>
              </div>
              {last ? null : (
                <span
                  aria-hidden="true"
                  className="block py-1 text-center text-xs text-[#5a6e32]/55"
                >
                  &darr;
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ POSITIONING CHART ━━━━━━━━━━━━━━━━━━━ */

// Vertical axis: depth of persistent health context. Horizontal axis:
// individual habits vs. a social health layer. Murph sits alone in
// the top-right quadrant.
const POSITIONING_POINTS = [
  { left: 25, name: "ChatGPT / Claude", top: 30 },
  { left: 34, name: "Bevel", top: 47 },
  { left: 27, name: "Oura / Whoop", top: 61 },
  { left: 25, name: "Apple Health / Garmin / Fitbit", top: 78 },
  { left: 71, name: "Strava / Stridekick", top: 73 },
] as const;

export function PositioningChart() {
  return (
    <div className="flex items-stretch gap-2.5">
      {/* Vertical-axis name */}
      <div className="flex items-center justify-center">
        <span className="rotate-180 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-[#5a6e32] [writing-mode:vertical-rl]">
          Persistent health context
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative aspect-[16/12] w-full overflow-hidden rounded-xl border border-[#c4a882]/30 bg-[#fffcf6]/90">
          {/* Axes */}
          <div className="absolute inset-y-0 left-1/2 w-px bg-[#c4a882]/30" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-[#c4a882]/30" />

          {/* Vertical-axis poles */}
          <span className="absolute left-3 top-3 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
            Long-term health memory
          </span>
          <span className="absolute bottom-3 left-3 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
            Raw metrics
          </span>

          {/* Competitor points */}
          {POSITIONING_POINTS.map((point) => (
            <div
              key={point.name}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
              style={{ left: `${point.left}%`, top: `${point.top}%` }}
            >
              <span className="size-2.5 rounded-full bg-[#d4c4a8]" />
              <span className="whitespace-nowrap text-[11px] font-medium text-[#736a58]">
                {point.name}
              </span>
            </div>
          ))}

          {/* Murph */}
          <div
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
            style={{ left: "80%", top: "17%" }}
          >
            <span className="flex size-4 items-center justify-center rounded-full bg-[#5a6e32] ring-4 ring-[#5a6e32]/15">
              <span className="size-1.5 rounded-full bg-[#fffcf6]" />
            </span>
            <span className="whitespace-nowrap font-serif text-sm font-semibold text-[#5a6e32]">
              Murph
            </span>
          </div>
        </div>

        {/* Horizontal-axis poles */}
        <div className="mt-2 flex w-full justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-[#736a58]">
          <span>Individual</span>
          <span>Social health layer</span>
        </div>
        {/* Horizontal-axis name */}
        <p className="mt-1 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-[#5a6e32]">
          Habit coordination
        </p>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ INSIGHT PATHS ━━━━━━━━━━━━━━━━━━━━━━━ */

// Slide 02 contrast, rendered on the dark slide. A dashboard is a
// straight line that dead-ends in churn; a challenge is a loop where
// each finished round seeds the next. The shape carries the argument,
// so the labels stay terse.
export function InsightPaths() {
  return (
    <div className="mt-9 grid gap-4 sm:grid-cols-2">
      {/* The dashboard — a line that stops */}
      <figure className="rounded-2xl border border-[#f5f0e8]/10 bg-[#f5f0e8]/[0.03] p-6">
        <PathLabel tone="dead" mark="✕">
          The dashboard
        </PathLabel>
        <div className="mt-5 flex flex-col gap-2">
          <PathStage tone="dead">Dashboard</PathStage>
          <PathStep tone="dead" />
          <PathStage tone="dead">Passive tracking</PathStage>
          <PathStep tone="dead" />
          <PathStage tone="dead">Churn</PathStage>
        </div>
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <span className="h-0.5 w-20 rounded-full bg-[#e9e2d4]/15" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#e9e2d4]/35">
            Stops here
          </span>
        </div>
      </figure>

      {/* The challenge — a loop that compounds */}
      <figure className="rounded-2xl border border-[#7a8c6e]/45 bg-[#7a8c6e]/[0.1] p-6">
        <PathLabel tone="live" mark="↻">
          The challenge
        </PathLabel>
        <div className="relative mt-5 pl-9">
          {/* return path: the last round loops back into the first.
              Fixed-size elbows at top and bottom, a stretchy dashed
              run between them, and a triangle pointing into stage 1. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-9"
          >
            <span className="absolute left-3 top-3 h-4 w-4 rounded-tl-[8px] border-l-2 border-t-2 border-dashed border-[#9fb389]/55" />
            <span className="absolute bottom-7 left-3 top-7 border-l-2 border-dashed border-[#9fb389]/55" />
            <span className="absolute bottom-3 left-3 h-4 w-4 rounded-bl-[8px] border-b-2 border-l-2 border-dashed border-[#9fb389]/55" />
            <span className="absolute left-[27px] top-[8px] h-0 w-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-[#9fb389]" />
          </div>
          <div className="flex flex-col gap-2">
            <PathStage tone="live">Group challenge</PathStage>
            <PathStep tone="live" />
            <PathStage tone="live">Competition + accountability</PathStage>
            <PathStep tone="live" />
            <PathStage tone="live">Everyone healthier</PathStage>
          </div>
        </div>
        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[#9fb389]/80">
          Every round feeds the next
        </p>
      </figure>
    </div>
  );
}

function PathLabel({
  children,
  tone,
  mark,
}: {
  children: ReactNode;
  tone: "dead" | "live";
  mark: string;
}) {
  const live = tone === "live";
  return (
    <figcaption className="flex items-center gap-2">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] leading-none ${
          live
            ? "border-[#9fb389]/50 text-[#9fb389]"
            : "border-[#e9e2d4]/20 text-[#e9e2d4]/45"
        }`}
      >
        {mark}
      </span>
      <span
        className={`font-mono text-[10px] font-medium uppercase tracking-[0.14em] ${
          live ? "text-[#9fb389]" : "text-[#e9e2d4]/45"
        }`}
      >
        {children}
      </span>
    </figcaption>
  );
}

function PathStage({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "dead" | "live";
}) {
  const live = tone === "live";
  return (
    <span
      className={`rounded-lg border px-3.5 py-2.5 text-center text-[13px] font-medium ${
        live
          ? "border-[#7a8c6e]/55 bg-[#7a8c6e]/[0.18] text-[#f5f0e8]"
          : "border-[#f5f0e8]/10 bg-[#f5f0e8]/[0.04] text-[#e9e2d4]/55"
      }`}
    >
      {children}
    </span>
  );
}

function PathStep({ tone }: { tone: "dead" | "live" }) {
  const live = tone === "live";
  return (
    <span
      aria-hidden="true"
      className={`text-center text-[13px] leading-none ${
        live ? "text-[#9fb389]/70" : "text-[#e9e2d4]/25"
      }`}
    >
      ↓
    </span>
  );
}
