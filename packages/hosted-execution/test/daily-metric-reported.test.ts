import { describe, expect, it } from "vitest";
import { resolveMetricDefinition } from "@murphai/health-metrics";

import { buildHostedExecutionDailyMetricReportedWake } from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import {
  HOSTED_EXECUTION_MEMBER_REPORTED_DAILY_METRIC_KEYS,
} from "../src/daily-metric.ts";
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

  it("accepts every reportable metric in its canonical unit", () => {
    for (const metric of HOSTED_EXECUTION_MEMBER_REPORTED_DAILY_METRIC_KEYS) {
      const definition = resolveMetricDefinition(metric);
      expect(definition?.canonicalUnit, metric).not.toBeNull();
      const canonicalUnit = definition?.canonicalUnit;
      if (!canonicalUnit) {
        throw new Error(`Expected a canonical unit for ${metric}.`);
      }

      expect(parseHostedExecutionWake({
        dailyMetric: {
          date: "2026-08-13",
          metric,
          unit: canonicalUnit,
          value: 25,
        },
        eventId: `daily-metric:report:${metric}`,
        kind: "health.daily-metric.reported",
        occurredAt: "2026-08-13T18:00:00.000Z",
        userId: "member_synthetic_001",
      })).toMatchObject({
        dailyMetric: { metric, unit: canonicalUnit, value: 25 },
      });
    }
  });

  it("canonicalizes equivalent unit spelling before enforcing projection bounds", () => {
    const parsed = parseHostedExecutionWake({
      dailyMetric: {
        date: "2026-08-13",
        metric: "total-sleep-minutes",
        unit: "min",
        value: 480,
      },
      eventId: "daily-metric:report:sleep",
      kind: "health.daily-metric.reported",
      occurredAt: "2026-08-13T18:00:00.000Z",
      userId: "member_synthetic_001",
    });
    expect(parsed).toMatchObject({
      dailyMetric: {
        metric: "total-sleep-minutes",
        unit: "minutes",
        value: 480,
      },
    });

    expect(() => parseHostedExecutionWake({
      dailyMetric: {
        date: "2026-08-13",
        metric: "total-sleep-minutes",
        unit: "min",
        value: 1_441,
      },
      eventId: "daily-metric:report:sleep:outside-range",
      kind: "health.daily-metric.reported",
      occurredAt: "2026-08-13T18:00:00.000Z",
      userId: "member_synthetic_001",
    })).toThrow(/outside the metric's supported range/u);
  });

  it("rejects incompatible metric units, including the display label for steps", () => {
    const base = {
      date: "2026-08-13",
      metric: "steps",
      value: 8_000,
    } as const;
    for (const unit of ["steps", "bpm"]) {
      expect(() => parseHostedExecutionWake({
        dailyMetric: { ...base, unit },
        eventId: `daily-metric:report:steps:${unit}`,
        kind: "health.daily-metric.reported",
        occurredAt: "2026-08-13T18:00:00.000Z",
        userId: "member_synthetic_001",
      })).toThrow(/unit is incompatible with the metric/u);
    }
  });

  it("rejects convertible but noncanonical units", () => {
    expect(() => parseHostedExecutionWake({
      dailyMetric: {
        date: "2026-08-13",
        metric: "total-sleep-minutes",
        unit: "hours",
        value: 8,
      },
      eventId: "daily-metric:report:sleep:hours",
      kind: "health.daily-metric.reported",
      occurredAt: "2026-08-13T18:00:00.000Z",
      userId: "member_synthetic_001",
    })).toThrow(/unit is incompatible with the metric/u);
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
