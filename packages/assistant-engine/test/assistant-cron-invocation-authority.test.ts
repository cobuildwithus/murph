import { describe, expect, it } from "vitest";

import {
  resolveAssistantCronScheduledInvocationAuthority,
} from "../src/assistant/cron/execution.ts";

const occurrenceAt = "2026-07-20T13:00:00.000Z";

function automationJob(schedule: unknown) {
  return {
    kind: "canonical" as const,
    source: {
      automationId: "automation_call_circle",
      kind: "automation" as const,
      schedule,
    },
  };
}

describe("scheduled automation invocation authority", () => {
  it("binds every claimed canonical automation occurrence", () => {
    for (const schedule of [
      { kind: "cron", expression: "0 9 * * 1" },
      { kind: "at", at: "2026-07-20T13:00:00.000Z" },
    ]) {
      expect(resolveAssistantCronScheduledInvocationAuthority({
        job: automationJob(schedule) as never,
        occurrenceAt,
        trigger: "scheduled",
      })).toEqual({
        automationId: "automation_call_circle",
        occurrenceAt,
      });
    }
  });

  it("does not mint authority for manual runs, local jobs, or non-automation records", () => {
    expect(resolveAssistantCronScheduledInvocationAuthority({
      job: automationJob({ kind: "cron", expression: "0 9 * * 1" }) as never,
      occurrenceAt,
      trigger: "manual",
    })).toBeNull();
    expect(resolveAssistantCronScheduledInvocationAuthority({
      job: { kind: "local" } as never,
      occurrenceAt,
      trigger: "scheduled",
    })).toBeNull();
    expect(resolveAssistantCronScheduledInvocationAuthority({
      job: {
        kind: "canonical",
        source: { kind: "scheduledLog" },
      } as never,
      occurrenceAt,
      trigger: "scheduled",
    })).toBeNull();
  });
});
