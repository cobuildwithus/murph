import { describe, expect, it } from "vitest";

import {
  experimentAdherenceTargetsSchema,
  experimentRunPlanSchema,
  experimentRunScheduleIntentSchema,
} from "../src/index.ts";
import { experimentFrontmatterSchema } from "../src/schemas.ts";
import type { JsonSchema } from "../src/types.ts";

function requiredProperty(schema: JsonSchema, propertyName: string): JsonSchema {
  const property = schema.properties?.[propertyName];
  if (!property) {
    throw new Error(`Expected JSON schema property ${propertyName}.`);
  }
  return property;
}

function findScheduleVariant(scheduleSchema: JsonSchema, kind: string): JsonSchema {
  const variant = scheduleSchema.oneOf?.find((candidate) => {
    return candidate.properties?.kind?.const === kind;
  });
  if (!variant) {
    throw new Error(`Expected schedule JSON schema variant ${kind}.`);
  }
  return variant;
}

describe("experiment run schedule intents", () => {
  it("accepts dailyLocal and cron run-plan schedules with time zones", () => {
    const dailyLocal = {
      kind: "dailyLocal",
      localTime: "08:30",
      timeZone: "America/New_York",
    } as const;
    const cron = {
      kind: "cron",
      expression: "0 8 * * 2,4,6",
      timeZone: "Europe/London",
    } as const;

    expect(experimentRunScheduleIntentSchema.parse(dailyLocal)).toEqual(dailyLocal);
    expect(experimentRunScheduleIntentSchema.parse(cron)).toEqual(cron);
    expect(experimentRunPlanSchema.parse({ schedule: dailyLocal }).schedule).toEqual(dailyLocal);
    expect(experimentRunPlanSchema.parse({ schedule: cron }).schedule).toEqual(cron);
  });

  it("rejects legacy strings, scheduled-log-only variants, and schedules without time zones", () => {
    const invalidSchedules = [
      "Take the evening dose 60 minutes before bed.",
      {
        kind: "at",
        at: "2026-04-22T08:00:00.000Z",
      },
      {
        kind: "every",
        everyMs: 900_000,
      },
      {
        kind: "dailyLocal",
        localTime: "08:30",
      },
      {
        kind: "cron",
        expression: "0 8 * * 2,4,6",
      },
      {
        kind: "cron",
        expression: "@daily",
        timeZone: "Europe/London",
      },
      {
        kind: "cron",
        expression: "0 8 * * 1-5",
        timeZone: "Europe/London",
      },
      {
        kind: "cron",
        expression: "0 8 */2 * 2,4,6",
        timeZone: "Europe/London",
      },
      {
        kind: "cron",
        expression: "0 8 * * MON",
        timeZone: "Europe/London",
      },
    ];

    for (const schedule of invalidSchedules) {
      expect(experimentRunPlanSchema.safeParse({ schedule }).success).toBe(false);
    }
  });

  it("emits the run-plan cron expression constraint into the generated JSON schema", () => {
    const runPlanSchema = requiredProperty(experimentFrontmatterSchema, "runPlan");
    const scheduleSchema = requiredProperty(runPlanSchema, "schedule");
    const cronSchema = findScheduleVariant(scheduleSchema, "cron");
    const expressionSchema = requiredProperty(cronSchema, "expression");

    expect(expressionSchema.pattern).toBe(
      "^(?:[0-5]?\\d)\\s+(?:[01]?\\d|2[0-3])\\s+\\*\\s+\\*\\s+[0-7](?:,[0-7])*$",
    );
  });
});

describe("experiment adherence targets", () => {
  it("accepts day-level linked event and metric targets on run plans", () => {
    const saunaTarget = {
      targetId: "sauna",
      label: "Sauna",
      phase: "intervention",
      calendar: {
        kind: "daily",
        timeZone: "America/New_York",
        targetCountPerDay: 1,
      },
      evidence: {
        kind: "linkedEventCount",
        eventKind: "intervention_session",
        missing: "missed_after_grace",
      },
      grace: { hours: 24 },
      rollup: {
        targetCompletions: 14,
        minimumUsefulCompletions: 7,
      },
    } as const;
    const stepTarget = {
      targetId: "step-floor",
      label: "Step floor",
      phase: "intervention",
      calendar: {
        kind: "daily",
        timeZone: "America/New_York",
      },
      evidence: {
        kind: "metricThreshold",
        metricKey: "steps",
        op: ">=",
        value: 8000,
        missing: "unknown",
      },
    } as const;

    expect(experimentAdherenceTargetsSchema.parse([saunaTarget, stepTarget])).toEqual([
      saunaTarget,
      stepTarget,
    ]);
    expect(experimentRunPlanSchema.parse({ adherenceTargets: [saunaTarget] }).adherenceTargets).toEqual([
      saunaTarget,
    ]);
    expect(
      experimentAdherenceTargetsSchema.safeParse([
        {
          ...saunaTarget,
          calendar: {
            kind: "explicitDates",
            timeZone: "America/New_York",
            dates: [
              { localDate: "2026-05-01", label: "First" },
              { localDate: "2026-05-01", label: "Duplicate" },
            ],
          },
        },
      ]).success,
    ).toBe(false);
  });

  it("accepts calendar-less linked activity targets", () => {
    const target = {
      targetId: "running",
      label: "Running",
      phase: "intervention",
      evidence: {
        kind: "linkedEventCount",
        eventKind: "activity_session",
        activityKind: "running",
        missing: "missed_after_grace",
      },
      rollup: {
        targetCompletions: 24,
        minimumUsefulCompletions: 12,
      },
    } as const;

    expect(experimentAdherenceTargetsSchema.parse([target])).toEqual([target]);
    expect(experimentRunPlanSchema.parse({ adherenceTargets: [target] }).adherenceTargets).toEqual([
      target,
    ]);
  });

  it("rejects ambiguous target ids and invalid threshold rules", () => {
    const target = {
      targetId: "sauna",
      label: "Sauna",
      phase: "intervention",
      calendar: {
        kind: "daily",
        timeZone: "America/New_York",
      },
      evidence: {
        kind: "metricThreshold",
        metricKey: "steps",
        op: "between",
        value: 8000,
        missing: "unknown",
      },
    } as const;

    expect(experimentAdherenceTargetsSchema.safeParse([target, target]).success).toBe(false);
    expect(experimentAdherenceTargetsSchema.safeParse([target]).success).toBe(false);
  });
});
