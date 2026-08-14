import { describe, expect, it } from "vitest";

import { buildHostedExecutionDailyMetricReportedWake } from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { isHostedMailboxKind } from "../src/runtime-control.ts";

describe("health.daily-metric.reported hosted execution wake", () => {
  it("builds and parses a typed system mailbox wake", () => {
    const wake = buildHostedExecutionDailyMetricReportedWake({
      date: "2026-08-13",
      eventId: "daily-metric:report:steps",
      memberId: "member_synthetic_001",
      metric: "steps",
      occurredAt: "2026-08-13T18:00:00.000Z",
      unit: "count",
      value: 8_000,
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(isHostedSystemWake(wake)).toBe(true);
    expect(isHostedMailboxKind(wake.kind)).toBe(true);
  });

  it("rejects metrics outside the existing daily share registry and its bounds", () => {
    const base = {
      eventId: "daily_metric_report_synthetic",
      kind: "health.daily-metric.reported",
      occurredAt: "2026-08-13T20:00:00.000Z",
      userId: "member_synthetic_001",
    } as const;

    expect(() => parseHostedExecutionWake({
      ...base,
      dailyMetric: {
        date: "2026-08-13",
        metric: "invented-score",
        unit: "points",
        value: 12,
      },
    })).toThrow(/metric is invalid/u);
    expect(() => parseHostedExecutionWake({
      ...base,
      dailyMetric: {
        date: "2026-08-13",
        metric: "steps",
        unit: "count",
        value: -1,
      },
    })).toThrow(/outside the metric's supported range/u);
  });

  it("rejects malformed metric reports", () => {
    expect(() =>
      buildHostedExecutionDailyMetricReportedWake({
        date: "2026-02-30",
        eventId: "daily-metric:report:steps",
        memberId: "member_synthetic_001",
        metric: "steps",
        occurredAt: "2026-08-13T18:00:00.000Z",
        unit: "count",
        value: 8_000,
      })
    ).toThrow(/date/u);

    expect(() =>
      parseHostedExecutionWake({
        dailyMetric: {
          date: "2026-08-13",
          metric: "Steps",
          unit: "count",
          value: 8_000,
        },
        eventId: "daily-metric:report:steps",
        kind: "health.daily-metric.reported",
        occurredAt: "2026-08-13T18:00:00.000Z",
        userId: "member_synthetic_001",
      })
    ).toThrow(/metric/u);
  });
});
