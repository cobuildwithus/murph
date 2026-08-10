"use client";

import type { ChallengeStandingsResponseCardV1 } from "@murphai/contracts";

import {
  ChallengeStandingsCardImage,
  getChallengeStandingsCardImageSize,
} from "@/src/components/imessage/challenge-standings-card-image";

const SYNTHETIC_TEAM_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "teams",
  title: "Summer movement challenge",
  subtitle: "Day 4 of 7",
  objective: { kind: "target", targetPoints: 250 },
  entries: [
    {
      label: "North team",
      points: 210,
      coverage: "complete",
      detail: null,
    },
    {
      label: "South team",
      points: 180,
      coverage: "partial",
      detail: null,
    },
    {
      label: "West team",
      points: null,
      coverage: "unscored",
      detail: null,
    },
  ],
  footer: null,
};

const SYNTHETIC_COLLECTIVE_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "collective",
  title: "Move together",
  subtitle: "Weekly progress",
  objective: { kind: "target", targetPoints: 1_000 },
  collectivePoints: 640,
  coverage: "partial",
  coverageCounts: {
    completeParticipants: 1,
    partialParticipants: 1,
    totalParticipants: 3,
    unscoredParticipants: 1,
  },
  footer: null,
};

export function ImessageChallengeStandingsCardStudy() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-8" inert>
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Static Messages preview
        </p>
        <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Challenge standings cards
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          The image fallback mirrors the native ranked and collective states.
          Titles lead directly, incomplete ranks stay neutral, and a shared
          target remains group progress rather than an individual result.
        </p>
      </div>
      <div className="hidden flex-col gap-8 sm:flex">
        <ScaledStandingsCard card={SYNTHETIC_TEAM_CARD} scale={0.72} />
        <ScaledStandingsCard card={SYNTHETIC_COLLECTIVE_CARD} scale={0.72} />
      </div>
      <div className="flex flex-col gap-5 sm:hidden">
        <ScaledStandingsCard card={SYNTHETIC_TEAM_CARD} scale={0.285} />
        <ScaledStandingsCard card={SYNTHETIC_COLLECTIVE_CARD} scale={0.285} />
      </div>
    </div>
  );
}

function ScaledStandingsCard({
  card,
  scale,
}: {
  card: ChallengeStandingsResponseCardV1;
  scale: number;
}) {
  const size = getChallengeStandingsCardImageSize(card);
  return (
    <div
      className="overflow-hidden rounded-xl border border-border"
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <div
        style={{
          width: size.width,
          height: size.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <ChallengeStandingsCardImage card={card} />
      </div>
    </div>
  );
}
