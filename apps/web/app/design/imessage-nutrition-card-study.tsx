"use client";

import type { DailyNutritionResponseCardV2 } from "@murphai/contracts";

import {
  IMESSAGE_NUTRITION_CARD_IMAGE_SIZE,
  NutritionCardImage,
} from "@/src/components/imessage/nutrition-card-image";

const SYNTHETIC_CARD: DailyNutritionResponseCardV2 = {
  kind: "daily_nutrition",
  version: 2,
  localDate: "2026-06-18",
  mealCount: 3,
  totals: {
    calories: { total: 1_840, mealCount: 3 },
    proteinGrams: { total: 112, mealCount: 3 },
    carbsGrams: { total: 206, mealCount: 3 },
    fatGrams: { total: 61, mealCount: 3 },
    fiberGrams: { total: 24, mealCount: 2 },
  },
  goals: {
    calories: { target: 2_200, status: "under_target" },
    proteinGrams: { target: 120, status: "under_target" },
    carbsGrams: null,
    fatGrams: null,
    fiberGrams: { target: 30, status: "unavailable" },
  },
};

export function ImessageNutritionCardStudy() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-8" inert>
      <div className="mb-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Static Messages preview
        </p>
        <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
          Daily nutrition card
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          The static fallback mirrors the shipping Messages balloon&apos;s default
          state and embeds the canonical Murph mark in its native badge
          footprint. Goal direction stays in the existing safe text recovery
          instead of repeating status words in the bitmap. Messages supplies
          the outer mask and concise date label; only partial totals add a short
          subcaption.
        </p>
      </div>
      <div className="hidden sm:block">
        <ScaledNutritionCard scale={0.72} />
      </div>
      <div className="sm:hidden">
        <ScaledNutritionCard scale={0.255} />
      </div>
    </div>
  );
}

function ScaledNutritionCard({ scale }: { scale: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border"
      style={{
        width: IMESSAGE_NUTRITION_CARD_IMAGE_SIZE.width * scale,
        height: IMESSAGE_NUTRITION_CARD_IMAGE_SIZE.height * scale,
      }}
    >
      <div
        style={{
          width: IMESSAGE_NUTRITION_CARD_IMAGE_SIZE.width,
          height: IMESSAGE_NUTRITION_CARD_IMAGE_SIZE.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <NutritionCardImage card={SYNTHETIC_CARD} />
      </div>
    </div>
  );
}
