import { describe, expect, it } from "vitest";
import { buildEnvironmentInterviewTopicId } from "@murphai/contracts";

import {
  buildHostedExecutionEnvironmentInterviewCompletedWake,
} from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { isHostedMailboxKind } from "../src/runtime-control.ts";

const COMPLETED_AT = "2026-08-20T18:00:00.000Z";
const COMPLETION_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("environment-interview.completed hosted execution wake", () => {
  it("builds and parses an allowlisted Environment update", () => {
    const wake = buildHostedExecutionEnvironmentInterviewCompletedWake({
      completedAt: COMPLETED_AT,
      completionId: COMPLETION_ID,
      eventId: `environment-interview:${COMPLETION_ID}`,
      memberId: "member_synthetic_001",
      occurredAt: COMPLETED_AT,
      topics: [
        {
          answers: [
            {
              aspectId: "sleep-environment",
              indicatorId: "night_temp_c",
              note: "The bedroom stays near 19 degrees at night.",
              value: 19,
            },
          ],
          topicId: buildEnvironmentInterviewTopicId("sleep", 0),
        },
      ],
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(isHostedSystemWake(wake)).toBe(true);
    expect(isHostedMailboxKind(wake.kind)).toBe(true);
  });

  it("rejects fields outside the declared topic", () => {
    expect(() =>
      parseHostedExecutionWake({
        environmentInterview: {
          completedAt: COMPLETED_AT,
          completionId: COMPLETION_ID,
          topics: [
            {
              answers: [
                {
                  aspectId: "workspace",
                  indicatorId: "work_mode",
                  value: "home",
                },
              ],
              topicId: "sleep:0",
            },
          ],
        },
        eventId: `environment-interview:${COMPLETION_ID}`,
        kind: "environment-interview.completed",
        occurredAt: COMPLETED_AT,
        userId: "member_synthetic_001",
      })
    ).toThrow(/outside this environment topic/u);
  });
});
