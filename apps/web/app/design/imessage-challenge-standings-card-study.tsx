"use client";

import type { ChallengeStandingsResponseCardV1 } from "@murphai/contracts";
import { useLayoutEffect, useRef, useState } from "react";

import {
  ChallengeStandingsCardImage,
  getChallengeStandingsCardImageSize,
} from "@/src/components/imessage/challenge-standings-card-image";

const SYNTHETIC_TEAM_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "teams",
  title: "Challenge standings",
  subtitle: null,
  objective: { kind: "target", targetPoints: 250 },
  entries: [
    {
      label: "Team 1",
      points: 210,
      coverage: "complete",
      detail: null,
    },
    {
      label: "Team 2",
      points: 180,
      coverage: "partial",
      detail: null,
    },
    {
      label: "Team 3",
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
  title: "Challenge standings",
  subtitle: null,
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
    <div
      className="rounded-2xl border border-border bg-card p-4 sm:p-8"
      data-design-component="imessage-challenge-standings-card"
      inert
    >
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Static Messages preview
        </p>
        <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Challenge standings cards
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          The identity-free image fallback mirrors the native ranked and
          collective hierarchy. Generic labels preserve scorer order,
          incomplete ranks stay neutral, and a shared target remains group
          progress rather than an individual result. The canonical Murph mark
          and title share the same aligned header used by workout and table
          cards, with optional supporting text directly under the title.
        </p>
      </div>
      <div className="flex flex-col gap-5 sm:gap-8">
        <ScaledStandingsCard card={SYNTHETIC_TEAM_CARD} />
        <ScaledStandingsCard card={SYNTHETIC_COLLECTIVE_CARD} />
      </div>
    </div>
  );
}

function ScaledStandingsCard({
  card,
}: {
  card: ChallengeStandingsResponseCardV1;
}) {
  const size = getChallengeStandingsCardImageSize(card);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.18);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const updateScale = () => {
      const contentWidth = Math.max(0, frame.clientWidth - 2);
      setScale(Math.min(0.72, contentWidth / size.width));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [size.width]);

  return (
    <div
      ref={frameRef}
      className="relative overflow-clip rounded-xl border border-border"
      data-challenge-card-frame={card.format}
      data-render-scale={scale.toFixed(4)}
      style={{
        width: "100%",
        maxWidth: size.width * 0.72,
        height: size.height * scale + 2,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
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
