"use client";

import type { CompactTablePresentationCardV1 } from "@murphai/contracts";

import {
  CompactTableCardImage,
  getCompactTableCardImageSize,
} from "@/src/components/imessage/compact-table-card-image";

const SYNTHETIC_WORKOUT_CARD: Extract<
  CompactTablePresentationCardV1,
  { workout: unknown }
> = {
  kind: "compact_table",
  version: 1,
  title: "Push day",
  subtitle: "4 of 6 sets complete",
  footer: "Tap an exercise to log or correct a set.",
  workout: {
    version: 1,
    state: "active",
    exercises: [
      {
        name: "Bench press",
        sets: [
          { status: "completed", target: "185 lb × 8", actual: "185 lb × 8" },
          { status: "completed", target: "185 lb × 8", actual: "185 lb × 7" },
          { status: "completed", target: "185 lb × 6–8", actual: "185 lb × 6" },
        ],
      },
      {
        name: "Incline dumbbell press",
        sets: [
          { status: "completed", target: "55 lb × 10", actual: "55 lb × 10" },
          { status: "pending", target: "55 lb × 8–10", actual: null },
          { status: "pending", target: null, actual: null },
        ],
      },
    ],
  },
};

const SYNTHETIC_TABLE_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Weekly plan",
  subtitle: "Three focused sessions",
  rowHeader: "Day",
  columns: ["Focus", "Sets", "Effort"],
  rows: [
    { label: "Monday", values: ["Upper body", "14", "Moderate"] },
    { label: "Wednesday", values: ["Lower body", "16", "Hard"] },
    { label: "Saturday", values: ["Full body", "12", "Easy"] },
  ],
  footer: "Adjust load when form slows down.",
};

export function ImessageCompactTableCardStudy() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-8" inert>
      <div className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Static Messages preview
        </p>
        <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Compact table cards
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          The image fallback mirrors the native workout summary and the shared
          generic table. Provider captions keep the complete values available
          when the raster cannot load.
        </p>
      </div>
      <div className="hidden flex-col gap-8 sm:flex">
        <ScaledCompactTableCard card={SYNTHETIC_WORKOUT_CARD} scale={0.72} />
        <ScaledCompactTableCard card={SYNTHETIC_TABLE_CARD} scale={0.62} />
      </div>
      <div className="flex flex-col gap-5 sm:hidden">
        <ScaledCompactTableCard card={SYNTHETIC_WORKOUT_CARD} scale={0.285} />
        <ScaledCompactTableCard card={SYNTHETIC_TABLE_CARD} scale={0.285} />
      </div>
    </div>
  );
}

function ScaledCompactTableCard({
  card,
  scale,
}: {
  card: CompactTablePresentationCardV1;
  scale: number;
}) {
  const size = getCompactTableCardImageSize(card);
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
        <CompactTableCardImage card={card} />
      </div>
    </div>
  );
}
