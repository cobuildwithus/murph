import { describe, expect, it } from "vitest";

import {
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

    expect(expressionSchema.pattern).toBe("^\\S+(?:\\s+\\S+){4}$");
  });
});
