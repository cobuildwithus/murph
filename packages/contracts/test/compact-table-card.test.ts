import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  assistantResponseCardSchema,
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
  IMESSAGE_APP_CARD_URL_PREFIX,
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

  it("accepts exact field and shape bounds within the aggregate URL limit", () => {
    const maximumTextCard: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      title: "T".repeat(compactTableCardV1Bounds.title),
      subtitle: "S".repeat(compactTableCardV1Bounds.subtitle),
      rowHeader: "H".repeat(compactTableCardV1Bounds.rowHeader),
      columns: ["C".repeat(compactTableCardV1Bounds.columnHeader)],
      rows: [{
        label: "L".repeat(compactTableCardV1Bounds.rowLabel),
        values: ["V".repeat(compactTableCardV1Bounds.cellValue)],
      }],
      footer: "F".repeat(compactTableCardV1Bounds.footer),
      tracking: null,
    };
    const maximumShapeCard: CompactTableResponseCardV1 = {
      ...TRACKED_WORKOUT_CARD,
      columns: Array.from(
        { length: compactTableCardV1Bounds.columns },
        (_, index) => `Set ${index + 1}`,
      ),
      rows: Array.from(
        { length: compactTableCardV1Bounds.rows },
        (_, rowIndex) => ({
          label: `Exercise ${rowIndex + 1}`,
          values: Array.from(
            { length: compactTableCardV1Bounds.columns },
            (_, valueIndex) => `${valueIndex + 1}`,
          ),
        }),
      ),
      footer: null,
      tracking: null,
    };

    expect(compactTableResponseCardV1Schema.parse(maximumTextCard)).toEqual(
      maximumTextCard,
    );
    expect(compactTableResponseCardV1Schema.parse(maximumShapeCard)).toEqual(
      maximumShapeCard,
    );
  });

  it("rejects the exact boundary introduced by the canonical origin", () => {
    const makeBoundaryCard = (lastCellLength: number) => ({
      ...TRACKED_WORKOUT_CARD,
      title: "Eight-exercise workout",
      subtitle: "Verified canonical workout snapshot for today",
      columns: ["Set 1", "Set 2", "Set 3", "Set 4"],
      rows: Array.from({ length: 8 }, (_, rowIndex) => ({
        label: `Exercise ${rowIndex + 1} movement pattern`,
        values: Array.from({ length: 4 }, (_, columnIndex) => {
          const cellLength = rowIndex === 7 && columnIndex === 3
            ? lastCellLength
            : 22;
          return `${rowIndex + columnIndex + 1}`.padEnd(cellLength, "x");
        }),
      })),
      footer: "Assists and spotted reps remain on the exact set note.",
      tracking: null,
    });
    const encodeLength = (card: ReturnType<typeof makeBoundaryCard>) => {
      const { tracking: _tracking, ...presentationCard } = card;
      return `${IMESSAGE_APP_CARD_URL_PREFIX}${Buffer.from(JSON.stringify({
        schemaVersion: 3,
        card: presentationCard,
      }), "utf8").toString("base64url")}`.length;
    };

    const acceptedCard = makeBoundaryCard(24);
    expect(encodeLength(acceptedCard)).toBe(2_047);
    expect(compactTableResponseCardV1Schema.parse(acceptedCard)).toEqual(
      acceptedCard,
    );

    const rejectedCard = makeBoundaryCard(25);
    expect(encodeLength(rejectedCard)).toBe(2_048);
    expect(compactTableResponseCardV1Schema.safeParse(rejectedCard).success)
      .toBe(false);
  });
});
