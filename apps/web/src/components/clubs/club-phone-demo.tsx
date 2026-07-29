"use client";

import { useEffect, useRef, useState } from "react";

import type { MurphHeadshotSrc } from "@/src/components/homepage/murph-headshot-avatar";
import {
  PhoneMock,
  type ExperimentResult,
  type PhoneMessage,
} from "@/src/components/homepage/phone-mock";

const CONVERSATION: ReadonlyArray<PhoneMessage> = [
  {
    from: "user",
    text: "can we see if the whole club can run 10,000 miles together in august?",
  },
  {
    from: "murph",
    text: "Absolutely. One shared goal, August 1–31. Should walking count too?",
  },
  {
    from: "user",
    text: "yes, everyone should be able to help",
  },
  {
    from: "murph",
    text: "Perfect. I’ll make the link, keep the total current, and send the updates.",
  },
];

const CHALLENGE_RESULT: ExperimentResult = {
  eyebrow: "ATL moves together",
  stats: [
    { label: "Miles", value: "6,842" },
    { label: "People", value: "78" },
    { label: "Days left", value: "12" },
  ],
  comparison: {
    label: "Ahead of pace",
    rows: [
      {
        delta: "+8% vs pace",
        label: "Club goal",
        level: 0.684,
        tone: "good",
        value: "68%",
      },
    ],
  },
};

const STAGES = [
  { durationMs: 1_250, messageCount: 1, showResult: false },
  { durationMs: 1_850, messageCount: 2, showResult: false },
  { durationMs: 1_000, messageCount: 3, showResult: false },
  { durationMs: 1_600, messageCount: 4, showResult: false },
  { durationMs: 4_800, messageCount: 4, showResult: true },
] as const;

const FINAL_STAGE_INDEX = STAGES.length - 1;
const INITIAL_COMPLETE_STATE_MS = 1_800;

export function ClubPhoneDemo({
  animate = true,
  murphHeadshotSrc,
}: {
  animate?: boolean;
  murphHeadshotSrc: MurphHeadshotSrc;
}) {
  const [stageIndex, setStageIndex] = useState(FINAL_STAGE_INDEX);
  const isInitialCompleteState = useRef(true);

  useEffect(() => {
    if (
      !animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const stage = STAGES[stageIndex] ?? STAGES[FINAL_STAGE_INDEX];
    const delay = isInitialCompleteState.current
      ? INITIAL_COMPLETE_STATE_MS
      : stage.durationMs;
    isInitialCompleteState.current = false;

    const timeout = window.setTimeout(() => {
      setStageIndex((current) =>
        current === FINAL_STAGE_INDEX ? 0 : current + 1,
      );
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [animate, stageIndex]);

  const stage = STAGES[stageIndex] ?? STAGES[FINAL_STAGE_INDEX];

  return (
    <div aria-label="Murph club challenge conversation in iMessage" aria-live="off">
      <PhoneMock
        key={stageIndex}
        conversationHeight={480}
        messages={CONVERSATION.slice(0, stage.messageCount)}
        murphHeadshotSrc={murphHeadshotSrc}
        result={stage.showResult ? CHALLENGE_RESULT : undefined}
        resultPlacement="after"
      />
    </div>
  );
}
