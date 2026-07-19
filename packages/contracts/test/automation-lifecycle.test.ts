import { describe, expect, it } from "vitest";

import {
  AUTOMATION_SUPPORT_SERIES_TAG_PREFIX,
  automationGroupChallengeScheduledTaskSchema,
  automationScaffoldPayloadSchema,
  buildAutomationSupportSeriesTag,
  parseAutomationSupportSeriesTag,
} from "../src/automation.ts";

function automationPayload() {
  return {
    title: "Sleep support",
    slug: "sleep-support",
    status: "active" as const,
    continuityPolicy: "preserve" as const,
    schedule: {
      kind: "every" as const,
      everyMs: 60_000,
    },
    route: {
      channel: "linq",
      deliveryTarget: "test-target",
      identityId: null,
      participantId: null,
      threadId: null,
    },
    instructions: "Offer one context-aware sleep support check-in.",
  };
}

describe("automation lifecycle contracts", () => {
  it("builds and parses one canonical support-series tag", () => {
    const tag = buildAutomationSupportSeriesTag("experiment:exp_sleep");

    expect(tag).toBe(
      `${AUTOMATION_SUPPORT_SERIES_TAG_PREFIX}experiment:exp_sleep`,
    );
    expect(parseAutomationSupportSeriesTag(tag)).toEqual({
      seriesId: "experiment:exp_sleep",
      tag,
    });
    expect(parseAutomationSupportSeriesTag("support-series:exp_sleep")).toBeNull();
    expect(() => buildAutomationSupportSeriesTag("contains whitespace"))
      .toThrow(/support series id/u);
    expect(buildAutomationSupportSeriesTag("a".repeat(200)))
      .toBe(`${AUTOMATION_SUPPORT_SERIES_TAG_PREFIX}${"a".repeat(200)}`);
    expect(() => buildAutomationSupportSeriesTag("a".repeat(201)))
      .toThrow(/support series id/u);
  });

  it("accepts an exclusive end and bounds one-shot retry time", () => {
    const recurring = automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      activeUntil: "2026-07-20T08:00:00.000-04:00",
    });
    expect(recurring.activeUntil).toBe("2026-07-20T08:00:00.000-04:00");

    const oneShot = automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      activeUntil: "2026-07-19T08:00:01.000-04:00",
      schedule: {
        kind: "at",
        at: "2026-07-19T08:00:00.000-04:00",
      },
    });
    expect(oneShot.activeUntil).toBe("2026-07-19T08:00:01.000-04:00");

    expect(() => automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      activeUntil: "2026-07-19T08:00:00.000-04:00",
      schedule: {
        kind: "at",
        at: "2026-07-19T08:00:00.000-04:00",
      },
    })).toThrow(/activeUntil must be after schedule\.at/u);
  });

  it("allows at most one valid support-series owner", () => {
    const first = buildAutomationSupportSeriesTag("experiment:exp_first");
    const second = buildAutomationSupportSeriesTag("experiment:exp_second");

    expect(() => automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      tags: [first, second],
    })).toThrow(/at most one support series/u);
    expect(() => automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      tags: [`${AUTOMATION_SUPPORT_SERIES_TAG_PREFIX}not valid`],
    })).toThrow(/valid canonical support series id/u);
  });

  it("persists only an exact typed support purpose", () => {
    const parsed = automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      supportKind: "check_in",
      tags: [buildAutomationSupportSeriesTag("habit:reg_sleep")],
    });

    expect(parsed.supportKind).toBe("check_in");
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      supportKind: "generic_support",
    }).success).toBe(false);
  });

  it("accepts only the three canonical group scheduled-task bindings", () => {
    expect(automationGroupChallengeScheduledTaskSchema.safeParse({
      kind: "group_health_update",
    }).success).toBe(false);

    for (const kind of ["group_notification", "group_health_update"] as const) {
      const parsed = automationScaffoldPayloadSchema.parse({
        ...automationPayload(),
        route: {
          ...automationPayload().route,
          threadIsDirect: false,
        },
        scheduledTask: { kind },
      });
      expect(parsed.scheduledTask).toEqual({ kind });
    }

    const parsed = automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "steps-days.v0",
      },
    });

    expect(parsed.scheduledTask).toEqual({
      kind: "group_challenge",
      knowledgeSlug: "morning-mobility",
      projectionScopeKey: "steps-days.v0",
    });
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_notification",
        projectionScopeKey: "steps-days.v0",
      },
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_health_update",
        knowledgeSlug: "morning-mobility",
      },
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "capabilities",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "steps-days.v0",
      },
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "Morning Mobility",
        projectionScopeKey: "steps-days.v0",
      },
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "steps-days.v0",
      },
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      continuityPolicy: "fresh",
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "steps-days.v0",
      },
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
      },
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "x".repeat(201),
      },
    }).success).toBe(false);
    expect(() => automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "steps-days.v0",
      },
    })).toThrow(/requires a finite activeUntil/u);
    expect(() => automationScaffoldPayloadSchema.parse({
      ...automationPayload(),
      activeUntil: "2026-07-20T23:00:00.000-04:00",
      route: {
        ...automationPayload().route,
        threadIsDirect: false,
      },
      schedule: {
        kind: "deviceActivity",
        after: "2026-07-18T12:00:00.000Z",
      },
      scheduledTask: {
        kind: "group_challenge",
        knowledgeSlug: "morning-mobility",
        projectionScopeKey: "steps-days.v0",
      },
    })).toThrow(/requires a time-driven schedule/u);
    for (const kind of ["group_notification", "group_health_update"] as const) {
      const fresh = automationScaffoldPayloadSchema.parse({
        ...automationPayload(),
        continuityPolicy: "fresh",
        route: {
          ...automationPayload().route,
          threadIsDirect: false,
        },
        scheduledTask: { kind },
      });
      expect(fresh.continuityPolicy).toBe("fresh");
      expect(() => automationScaffoldPayloadSchema.parse({
        ...automationPayload(),
        scheduledTask: { kind },
      })).toThrow(/requires an explicit non-direct Linq group route/u);
      expect(() => automationScaffoldPayloadSchema.parse({
        ...automationPayload(),
        route: {
          ...automationPayload().route,
          channel: "telegram",
          threadIsDirect: false,
        },
        scheduledTask: { kind },
      })).toThrow(/requires an explicit non-direct Linq group route/u);
      expect(() => automationScaffoldPayloadSchema.parse({
        ...automationPayload(),
        route: {
          ...automationPayload().route,
          threadIsDirect: false,
        },
        schedule: {
          kind: "deviceActivity",
          after: "2026-07-18T12:00:00.000Z",
        },
        scheduledTask: { kind },
      })).toThrow(/requires a time-driven schedule/u);
    }
  });
});
