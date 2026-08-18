import { describe, expect, it } from "vitest";

import {
  AUTOMATION_SUPPORT_SERIES_TAG_PREFIX,
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
      plannedOccurrenceOffsetMs: 900_000,
      tags: [buildAutomationSupportSeriesTag("habit:reg_sleep")],
    });

    expect(parsed.supportKind).toBe("check_in");
    expect(parsed.plannedOccurrenceOffsetMs).toBe(900_000);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      plannedOccurrenceOffsetMs: -1,
    }).success).toBe(false);
    expect(automationScaffoldPayloadSchema.safeParse({
      ...automationPayload(),
      supportKind: "generic_support",
    }).success).toBe(false);
  });
});
