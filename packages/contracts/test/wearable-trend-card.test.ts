import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
  assistantResponseCardMatchesConversationAudience,
  assistantResponseCardSchema,
  averageWearableTrendValues,
  buildWearableTrendAppCardEnvelopeV7,
  formatWearableTrendDateRange,
  formatWearableTrendDirection,
  formatWearableTrendMetricAverage,
  formatWearableTrendMetricValue,
  formatWearableTrendWeekdayLabels,
  renderWearableTrendSparkline,
  wearableTrendAppCardEnvelopeV7Schema,
  wearableTrendCardRequestV1Schema,
  wearableTrendMetricDisplayByKey,
  wearableTrendResponseCardV1Schema,
  type WearableTrendResponseCardV1,
} from "../src/index.ts";

const CARD: WearableTrendResponseCardV1 = {
  kind: "wearable_trend",
  version: 1,
  localDates: [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ],
  metrics: [
    {
      metricKey: "steps",
      values: [6_800, 7_900, 9_400, 8_700, 10_200, 7_100, 9_800],
      trend: "higher",
    },
    {
      metricKey: "total-sleep-minutes",
      values: [432, 438, 428, 441, 435, 439, 434],
      trend: "steady",
    },
    {
      metricKey: "hrv-rmssd",
      values: [37, 41, 39, 45, 47, 44, 50],
      trend: "higher",
    },
  ],
};

describe("wearable trend response-card contract", () => {
  it("accepts one authority-free, date-aligned trusted snapshot", () => {
    expect(wearableTrendResponseCardV1Schema.parse(CARD)).toEqual(CARD);
    expect(assistantResponseCardSchema.parse(CARD)).toEqual(CARD);
    expect(assistantResponseCardMatchesConversationAudience({
      card: CARD,
      channel: "linq",
      threadIsDirect: true,
    })).toBe(true);
    expect(assistantResponseCardMatchesConversationAudience({
      card: CARD,
      channel: "linq",
      threadIsDirect: false,
    })).toBe(false);
    expect(buildWearableTrendAppCardEnvelopeV7(CARD)).toEqual({
      schemaVersion: 7,
      card: CARD,
    });
    expect(wearableTrendAppCardEnvelopeV7Schema.parse({
      schemaVersion: 7,
      card: CARD,
    })).toEqual({ schemaVersion: 7, card: CARD });

    const encoded = Buffer.from(JSON.stringify({
      schemaVersion: 7,
      card: CARD,
    }), "utf8").toString("base64url");
    expect(encoded.length).toBeLessThanOrEqual(
      IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
    );
    expect(JSON.stringify(CARD)).not.toMatch(
      /provider|source|timeZone|savedViewId|entityId|snapshotAt/iu,
    );
  });

  it("keeps authoring selection value-free and mutually exclusive", () => {
    expect(wearableTrendCardRequestV1Schema.parse({
      metricKeys: ["steps", "total-sleep-minutes", "hrv-rmssd"],
    })).toEqual({
      metricKeys: ["steps", "total-sleep-minutes", "hrv-rmssd"],
    });
    expect(wearableTrendCardRequestV1Schema.parse({
      savedViewId: "hview_01K1ABCDEFGHJKMNPQRSTVWXYZ",
    })).toEqual({ savedViewId: "hview_01K1ABCDEFGHJKMNPQRSTVWXYZ" });

    for (const request of [
      {},
      { metricKeys: ["steps"], values: [1] },
      { metricKeys: ["steps", "steps"] },
      { metricKeys: ["hrv"] },
      {
        metricKeys: ["steps"],
        savedViewId: "hview_01K1ABCDEFGHJKMNPQRSTVWXYZ",
      },
      { savedViewId: " saved-view " },
      { savedViewId: "saved-view" },
      { savedViewId: "hview_01K1ABCDEFGHJKMNPQRSTVWXYI" },
    ]) {
      expect(wearableTrendCardRequestV1Schema.safeParse(request).success).toBe(
        false,
      );
    }
  });

  it("requires exactly seven consecutive dates and seven values per row", () => {
    for (const invalid of [
      {
        ...CARD,
        localDates: CARD.localDates.slice(0, 6),
      },
      {
        ...CARD,
        localDates: CARD.localDates.map((date, index) =>
          index === 3 ? "2026-08-29" : date
        ),
      },
      {
        ...CARD,
        metrics: [{
          ...CARD.metrics[0],
          values: CARD.metrics[0]!.values.slice(0, 6),
        }],
      },
    ]) {
      expect(wearableTrendResponseCardV1Schema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("rejects malformed dates without throwing from cross-date validation", () => {
    for (let index = 0; index < CARD.localDates.length; index += 1) {
      const localDates = [...CARD.localDates];
      localDates[index] = "not-a-date";
      expect(() => wearableTrendResponseCardV1Schema.safeParse({
        ...CARD,
        localDates,
      })).not.toThrow();
      expect(wearableTrendResponseCardV1Schema.safeParse({
        ...CARD,
        localDates,
      }).success).toBe(false);
    }
  });

  it("keeps metric identity, ordering, values, and comparison status strict", () => {
    expect(wearableTrendResponseCardV1Schema.safeParse({
      ...CARD,
      metrics: [CARD.metrics[0], CARD.metrics[0]],
    }).success).toBe(false);
    expect(wearableTrendResponseCardV1Schema.safeParse({
      ...CARD,
      metrics: [{
        metricKey: "hrv",
        values: Array.from({ length: 7 }, () => 42),
        trend: "higher",
      }],
    }).success).toBe(false);
    expect(wearableTrendResponseCardV1Schema.safeParse({
      ...CARD,
      metrics: [{
        metricKey: "steps",
        values: [6_800, null, null, null, null, null, null],
        trend: "higher",
      }],
    }).success).toBe(false);
    expect(wearableTrendResponseCardV1Schema.safeParse({
      ...CARD,
      metrics: [{
        metricKey: "steps",
        values: [6_800, null, null, null, null, null, null],
        trend: "not_enough_data",
      }],
    }).success).toBe(true);
    expect(wearableTrendResponseCardV1Schema.safeParse({
      ...CARD,
      metrics: [{
        metricKey: "resting-heart-rate",
        values: [301, 60, 61, 62, 63, 64, 65],
        trend: "higher",
      }],
    }).success).toBe(false);
  });

  it("derives compact values, averages, dates, and neutral comparisons", () => {
    expect(formatWearableTrendDateRange(CARD.localDates)).toBe("Aug 24–30");
    expect(formatWearableTrendWeekdayLabels(CARD.localDates)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(formatWearableTrendDateRange([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ])).toBe("Dec 29, 2025–Jan 4, 2026");
    expect(formatWearableTrendMetricValue("steps", 10_200)).toBe("10.2k");
    expect(formatWearableTrendMetricValue("total-sleep-minutes", 432)).toBe(
      "7h12m",
    );
    expect(formatWearableTrendMetricValue("hrv-rmssd", null)).toBe("—");
    expect(formatWearableTrendMetricAverage(
      "steps",
      CARD.metrics[0]!.values,
    )).toBe("8.6k");
    expect(formatWearableTrendMetricAverage(
      "total-sleep-minutes",
      CARD.metrics[1]!.values,
    )).toBe("7h15m");
    expect(formatWearableTrendMetricAverage(
      "hrv-rmssd",
      CARD.metrics[2]!.values,
    )).toBe("43 ms");
    expect(averageWearableTrendValues([null, 10, null, 20])).toBe(15);
    expect(formatWearableTrendDirection("not_enough_data")).toBe("unavailable");
    expect(wearableTrendMetricDisplayByKey["hrv-rmssd"]).toMatchObject({
      hrvMethod: "RMSSD",
      displayUnit: "ms",
    });
  });

  it("renders seven stable spark positions for dense, sparse, and flat rows", () => {
    expect(renderWearableTrendSparkline(CARD.metrics[0]!.values)).toBe(
      "▁▃▆▅█▂▇",
    );
    expect(renderWearableTrendSparkline([
      6_800,
      null,
      null,
      8_700,
      null,
      null,
      9_800,
    ])).toBe("▁··▅··█");
    expect(renderWearableTrendSparkline([42, 42, 42, null, 42, 42, 42])).toBe(
      "▄▄▄·▄▄▄",
    );
    expect(renderWearableTrendSparkline(Array.from({ length: 7 }, () => null)))
      .toBe("·······");
  });
});
