"use client";

import type { CompactTablePresentationCardV1 } from "@murphai/contracts";

import {
  CompactTableCardImage,
  getCompactTableCardImageSize,
} from "@/src/components/imessage/compact-table-card-image";

const SYNTHETIC_TARGETLESS_WORKOUT_CARD: Extract<
  CompactTablePresentationCardV1,
  { workout: unknown }
> = {
  kind: "compact_table",
  version: 1,
  title: "Pull day",
  subtitle: null,
  footer: "Reply with the exercise, set, and result to log or correct it.",
  workout: {
    version: 1,
    state: "active",
    exercises: [
      {
        name: "Single-arm cable row with controlled tempo",
        sets: [
          { status: "pending", target: null, actual: null },
          { status: "pending", target: "70 lb × 10", actual: null },
        ],
      },
    ],
  },
};

const SYNTHETIC_DENSE_TABLE_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Eight-exercise workout",
  subtitle: "Four complete set notes per exercise",
  rowHeader: "Exercise",
  columns: ["Set 1", "Set 2", "Set 3", "Set 4"],
  rows: [
    {
      label: "Barbell back squat",
      values: [
        "185 lb × 8 tempo",
        "185 lb × 7 paused",
        "175 lb × 9 clean",
        "165 lb × 10",
      ],
    },
    {
      label: "Romanian deadlift",
      values: ["155 lb × 10", "155 lb × 9", "145 lb × 11", "135 lb × 12"],
    },
    {
      label: "Walking lunge",
      values: [
        "40 lb × 12 each",
        "40 lb × 11 each",
        "35 lb × 12 each",
        "Bodyweight × 16",
      ],
    },
    {
      label: "Leg press",
      values: ["270 lb × 12", "270 lb × 11", "250 lb × 14", "230 lb × 16"],
    },
    {
      label: "Seated leg curl",
      values: [
        "90 lb × 12 slow",
        "90 lb × 11 slow",
        "80 lb × 14",
        "70 lb × 16",
      ],
    },
    {
      label: "Standing calf raise",
      values: ["120 lb × 15", "120 lb × 14", "110 lb × 17", "100 lb × 20"],
    },
    {
      label: "Cable hip abduction",
      values: [
        "25 lb × 15 each",
        "25 lb × 14 each",
        "20 lb × 18 each",
        "20 lb × 16 each",
      ],
    },
    {
      label: "Weighted plank",
      values: [
        "45 lb × 45 sec",
        "45 lb × 40 sec",
        "35 lb × 50 sec",
        "Bodyweight × 60 sec",
      ],
    },
  ],
  footer: "Reply with any exercise, set, and correction.",
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
          The image fallback keeps a targetless first pending set honest and
          measures every wrapped row in the dense four-column boundary. Stacked
          fields keep each header above its full-width value so contract-limit
          text cannot collide or clip.
          The rectangular raster embeds the canonical Murph mark in the native
          badge footprint, while Messages supplies the outer corner mask.
          Provider chrome stays concise; the complete semantic fallback remains
          available as text.
        </p>
      </div>
      <div className="hidden flex-col gap-8 sm:flex">
        <ScaledCompactTableCard
          card={SYNTHETIC_TARGETLESS_WORKOUT_CARD}
          scale={0.72}
        />
        <ScaledCompactTableCard card={SYNTHETIC_DENSE_TABLE_CARD} scale={0.62} />
      </div>
      <div className="flex flex-col gap-5 sm:hidden">
        <ScaledCompactTableCard
          card={SYNTHETIC_TARGETLESS_WORKOUT_CARD}
          scale={0.25}
        />
        <ScaledCompactTableCard card={SYNTHETIC_DENSE_TABLE_CARD} scale={0.25} />
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
