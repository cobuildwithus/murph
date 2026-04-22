import { describe, expect, it } from "vitest";

import {
  SCHEDULED_LOG_DOC_TYPE,
  SCHEDULED_LOG_SCHEMA_VERSION,
  scheduleIntentAtSchema,
  scheduleIntentCronSchema,
  scheduleIntentDailyLocalSchema,
  scheduleIntentEverySchema,
  scheduleIntentSchema,
  scheduledLogActionSchema,
  scheduledLogFrontmatterSchema,
  scheduledLogMarkdownDocumentSchema,
  scheduledLogScaffoldPayloadSchema,
} from "../src/index.ts";

describe("scheduled-log contracts", () => {
  it("accepts supported schedule and action variants", () => {
    expect(scheduleIntentAtSchema.parse({
      kind: "at",
      at: "2026-04-22T08:00:00.000Z",
    })).toEqual({
      kind: "at",
      at: "2026-04-22T08:00:00.000Z",
    });

    expect(scheduleIntentEverySchema.parse({
      kind: "every",
      everyMs: 900_000,
    })).toEqual({
      kind: "every",
      everyMs: 900_000,
    });

    expect(scheduleIntentCronSchema.parse({
      kind: "cron",
      expression: "0 6 * * *",
    })).toEqual({
      kind: "cron",
      expression: "0 6 * * *",
    });

    expect(scheduleIntentDailyLocalSchema.parse({
      kind: "dailyLocal",
      localTime: "18:30",
    })).toEqual({
      kind: "dailyLocal",
      localTime: "18:30",
    });

    expect(scheduleIntentSchema.parse({
      kind: "cron",
      expression: "15 7 * * 1-5",
    })).toEqual({
      kind: "cron",
      expression: "15 7 * * 1-5",
    });

    expect(scheduledLogActionSchema.parse({
      kind: "meal.add",
      note: "Recovery shake",
      tags: ["nutrition"],
    })).toMatchObject({
      kind: "meal.add",
      note: "Recovery shake",
      tags: ["nutrition"],
    });

    expect(scheduledLogActionSchema.parse({
      kind: "activity_session.add",
      title: "Mobility",
      activityType: "mobility",
      durationMinutes: 15,
    })).toMatchObject({
      kind: "activity_session.add",
      title: "Mobility",
      activityType: "mobility",
      durationMinutes: 15,
    });

    expect(scheduledLogActionSchema.parse({
      kind: "intervention_session.add",
      title: "Sauna",
      interventionType: "sauna",
      durationMinutes: 20,
      protocolId: "prot_01JX8SAXQXQXQXQXQXQXQXQXQX",
    })).toMatchObject({
      kind: "intervention_session.add",
      title: "Sauna",
      interventionType: "sauna",
      durationMinutes: 20,
      protocolId: "prot_01JX8SAXQXQXQXQXQXQXQXQXQX",
    });

    expect(scheduledLogActionSchema.parse({
      kind: "measurement.add",
      measurements: [
        {
          metric: "body-weight",
          value: 181.4,
          unit: "lb",
        },
      ],
    })).toMatchObject({
      kind: "measurement.add",
      measurements: [
        {
          metric: "body-weight",
          value: 181.4,
          unit: "lb",
        },
      ],
    });
  });

  it("builds full frontmatter and scaffold payloads", () => {
    const scaffold = scheduledLogScaffoldPayloadSchema.parse({
      title: "Daily Sauna",
      schedule: {
        kind: "dailyLocal",
        localTime: "18:00",
      },
      action: {
        kind: "intervention_session.add",
        title: "Sauna",
        interventionType: "sauna",
        durationMinutes: 20,
      },
      body: "Writes a sauna intervention event.",
    });

    expect(scaffold.status).toBe("active");

    const frontmatter = scheduledLogFrontmatterSchema.parse({
      schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
      docType: SCHEDULED_LOG_DOC_TYPE,
      scheduledLogId: "slog_01JX8SC2Y2M5ZBV64ZP4N1DRB1",
      slug: "daily-sauna",
      title: "Daily Sauna",
      status: "active",
      schedule: scaffold.schedule,
      action: scaffold.action,
      summary: "Auto-log a daily sauna session.",
      tags: ["sauna", "scheduled"],
      createdAt: "2026-04-22T10:00:00.000Z",
      updatedAt: "2026-04-22T10:00:00.000Z",
    });

    expect(frontmatter).toMatchObject({
      schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
      docType: SCHEDULED_LOG_DOC_TYPE,
      scheduledLogId: "slog_01JX8SC2Y2M5ZBV64ZP4N1DRB1",
      slug: "daily-sauna",
      title: "Daily Sauna",
      status: "active",
    });

    expect(scheduledLogMarkdownDocumentSchema.parse({
      frontmatter,
      body: scaffold.body ?? "",
    })).toMatchObject({
      frontmatter,
      body: "Writes a sauna intervention event.",
    });
  });

  it("rejects invalid meal payloads, bad local times, and malformed frontmatter", () => {
    const missingMealContent = scheduledLogActionSchema.safeParse({
      kind: "meal.add",
      tags: ["scheduled"],
    });
    expect(missingMealContent.success).toBe(false);

    if (!missingMealContent.success) {
      expect(missingMealContent.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              "meal.add scheduled logs require a foodId, note, ingredients, or nutrition template.",
          }),
        ]),
      );
    }

    expect(scheduleIntentDailyLocalSchema.safeParse({
      kind: "dailyLocal",
      localTime: "24:00",
    }).success).toBe(false);

    expect(scheduledLogFrontmatterSchema.safeParse({
      schemaVersion: SCHEDULED_LOG_SCHEMA_VERSION,
      docType: SCHEDULED_LOG_DOC_TYPE,
      scheduledLogId: "bad-id",
      slug: "daily-sauna",
      title: "Daily Sauna",
      status: "active",
      schedule: {
        kind: "dailyLocal",
        localTime: "18:00",
      },
      action: {
        kind: "intervention_session.add",
        title: "Sauna",
        interventionType: "sauna",
      },
      createdAt: "2026-04-22T10:00:00.000Z",
      updatedAt: "2026-04-22T10:00:00.000Z",
    }).success).toBe(false);
  });
});
