"use client";

import type { ReactNode } from "react";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pitch deck mocks — the illustrative visuals dropped into slides:
   chat threads, diagrams, and the positioning chart.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

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
  messages,
  sentBubble = "dark",
  ...header
}: {
  title: string;
  messages: readonly ChatMessage[];
  // Fill treatment for the sender's bubbles — see SentBubble.
  sentBubble?: SentBubble;
} & ({ members: number } | { subtitle: string })) {
  const sentFill = SENT_FILLS[sentBubble];
  const headerDetail =
    "subtitle" in header ? header.subtitle : `${header.members} members`;
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
            {headerDetail}
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

/* ━━━━━━━━━━━━━━━━━━━━━━━━━ POSITIONING CHART ━━━━━━━━━━━━━━━━━━━ */

// Vertical axis: how much long-term health context a product keeps.
// Horizontal axis: individual use vs. getting people to act together.
// One point per category named on the competition slide; Murph sits
// alone in the top-right.
const POSITIONING_POINTS = [
  { left: 22, name: "ChatGPT / Claude", top: 24 },
  { left: 30, name: "Function", top: 48 },
  { left: 31, name: "Oura / Whoop / Apple Watch", top: 74 },
  { left: 72, name: "Strava", top: 72 },
] as const;

export function PositioningChart() {
  return (
    <div className="flex items-stretch gap-4">
      {/* Vertical-axis name */}
      <div className="flex items-center justify-center">
        <span className="rotate-180 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-[#736a58] [writing-mode:vertical-rl]">
          Long-term health context &rarr;
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative aspect-square w-full border-b border-l border-[#c4a882]/60">
          {/* Competitor points */}
          {POSITIONING_POINTS.map((point) => (
            <div
              key={point.name}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
              style={{ left: `${point.left}%`, top: `${point.top}%` }}
            >
              <span className="size-2.5 rounded-full bg-[#c4a882]" />
              <span className="whitespace-nowrap text-[13px] text-[#736a58]">
                {point.name}
              </span>
            </div>
          ))}

          {/* Murph */}
          <div
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
            style={{ left: "78%", top: "20%" }}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-[#5a6e32] ring-[6px] ring-[#5a6e32]/15">
              <span className="size-2 rounded-full bg-[#fffcf6]" />
            </span>
            <span className="whitespace-nowrap font-serif text-[1.35rem] font-semibold text-[#5a6e32]">
              Murph
            </span>
          </div>
        </div>
        {/* Horizontal-axis name */}
        <p className="mt-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-[#736a58]">
          Gets people to act together &rarr;
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
