import { describe, expect, it } from "vitest";

import {
  assistantResponseCardSchema,
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
  type CompactTableResponseCardV1,
  type CompactTableTrackingSourceV1,
} from "../src/index.ts";

const WORKOUT_TRACKING: CompactTableTrackingSourceV1 = {
  kind: "workout",
  entityId: "evt_01K1ABCDEFGHJKMNPQRSTVWXYZ",
  snapshotAt: "2026-08-04T21:30:00.000Z",
};

const TRACKED_WORKOUT_CARD: CompactTableResponseCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Upper body A",
  subtitle: "Live workout",
  rowHeader: "Exercise",
  columns: ["Completed", "Latest", "Effort"],
  rows: [
    {
      label: "Bench press",
      values: ["2 sets", "185 lb × 8", "RPE 8"],
    },
    {
      label: "One-arm row",
      values: ["3 sets", "80 lb × 10", "2 left"],
    },
  ],
  footer: "Tell Murph after each set for a refreshed snapshot.",
  tracking: WORKOUT_TRACKING,
};

const NUTRITION_CARD = {
  kind: "daily_nutrition",
  localDate: "2026-08-04",
  mealCount: 1,
  totals: {
    calories: { total: 500, mealCount: 1 },
    proteinGrams: { total: 30, mealCount: 1 },
    carbsGrams: { total: 40, mealCount: 1 },
    fatGrams: { total: 20, mealCount: 1 },
  },
} as const;

describe("compact table response-card contract", () => {
  it("accepts a bounded table backed by one canonical workout", () => {
    expect(compactTableResponseCardV1Schema.parse(TRACKED_WORKOUT_CARD)).toEqual(
      TRACKED_WORKOUT_CARD,
    );
    expect(assistantResponseCardSchema.parse(TRACKED_WORKOUT_CARD)).toEqual(
      TRACKED_WORKOUT_CARD,
    );
  });

  it("accepts a one-off table without tracking authority", () => {
    const oneOffCard = {
      ...TRACKED_WORKOUT_CARD,
      tracking: null,
    };

    expect(compactTableResponseCardV1Schema.parse(oneOffCard)).toEqual(
      oneOffCard,
    );
  });

  it("keeps the existing nutrition response-card branch readable", () => {
    expect(assistantResponseCardSchema.parse(NUTRITION_CARD)).toEqual(
      NUTRITION_CARD,
    );
  });

  it("rejects unknown card kinds and extra fields", () => {
    expect(assistantResponseCardSchema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      kind: "workout_table",
    }).success).toBe(false);
    expect(compactTableResponseCardV1Schema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      extra: true,
    }).success).toBe(false);
  });

  it("requires one value for every declared value column", () => {
    expect(compactTableResponseCardV1Schema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      rows: [
        {
          label: "Bench press",
          values: ["2 sets", "185 lb × 8"],
        },
      ],
    }).success).toBe(false);

    expect(compactTableResponseCardV1Schema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      rows: [
        {
          label: "Bench press",
          values: ["2 sets", "185 lb × 8", "RPE 8", "90 sec"],
        },
      ],
    }).success).toBe(false);
  });

  it("enforces the compact column and row bounds", () => {
    expect(compactTableResponseCardV1Schema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      columns: ["Set 1", "Set 2", "Set 3", "Set 4", "Set 5"],
      rows: [
        {
          label: "Exercise A",
          values: ["10", "10", "9", "8", "7"],
        },
      ],
    }).success).toBe(false);

    expect(compactTableResponseCardV1Schema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      rows: Array.from(
        { length: compactTableCardV1Bounds.rows + 1 },
        (_, index) => ({
          label: `Exercise ${index + 1}`,
          values: ["1 set", "10 reps", "RPE 7"],
        }),
      ),
    }).success).toBe(false);

    expect(compactTableResponseCardV1Schema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      rows: [],
    }).success).toBe(false);
  });

  it("rejects surrounding whitespace, controls, and multiline cells", () => {
    for (const invalidTitle of [
      " Upper body A",
      "Upper body A ",
      "Upper\nbody A",
      "Upper\tbody A",
    ]) {
      expect(compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        title: invalidTitle,
      }).success).toBe(false);
    }

    expect(compactTableResponseCardV1Schema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      rows: [
        {
          label: "Bench press",
          values: ["2 sets", "185 lb\n× 8", "RPE 8"],
        },
      ],
    }).success).toBe(false);
  });

  it("requires a canonical workout event id and printable snapshot marker", () => {
    for (const entityId of [
      "workout-123",
      "evt_",
      "evt_abc-123",
      " evt_abc123",
    ]) {
      expect(compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        tracking: {
          ...WORKOUT_TRACKING,
          entityId,
        },
      }).success).toBe(false);
    }

    for (const snapshotAt of [
      " 2026-08-04T21:30:00.000Z",
      "2026-08-04T21:30:00.000Z ",
      "2026-08-04\n21:30:00Z",
    ]) {
      expect(compactTableResponseCardV1Schema.safeParse({
        ...TRACKED_WORKOUT_CARD,
        tracking: {
          ...WORKOUT_TRACKING,
          snapshotAt,
        },
      }).success).toBe(false);
    }
  });

  it("accepts exact maximum text and shape bounds", () => {
    const maximumCard: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      title: "T".repeat(compactTableCardV1Bounds.title),
      subtitle: "S".repeat(compactTableCardV1Bounds.subtitle),
      rowHeader: "H".repeat(compactTableCardV1Bounds.rowHeader),
      columns: Array.from(
        { length: compactTableCardV1Bounds.columns },
        (_, index) => `${index}`.repeat(compactTableCardV1Bounds.columnHeader),
      ),
      rows: Array.from(
        { length: compactTableCardV1Bounds.rows },
        (_, rowIndex) => ({
          label: `${rowIndex}`.repeat(compactTableCardV1Bounds.rowLabel),
          values: Array.from(
            { length: compactTableCardV1Bounds.columns },
            (_, valueIndex) =>
              `${valueIndex}`.repeat(compactTableCardV1Bounds.cellValue),
          ),
        }),
      ),
      footer: "F".repeat(compactTableCardV1Bounds.footer),
      tracking: null,
    };

    expect(compactTableResponseCardV1Schema.parse(maximumCard)).toEqual(
      maximumCard,
    );
  });
});
