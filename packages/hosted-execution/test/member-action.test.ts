import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActionRequestedWake,
} from "../src/builders.ts";
import {
  parseHostedExecutionEvent,
  parseHostedExecutionWake,
} from "../src/parsers.ts";

const request = {
  action: {
    expectedWorkout: {
      exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
    },
    kind: "workout.live.apply" as const,
    mutations: [{
      exerciseName: "Leg press",
      exercisePosition: 1,
      expectedResult: null,
      kind: "set.put" as const,
      requiresExistingSet: true,
      result: { kind: "reps" as const, reps: 8 },
      setPosition: 1,
    }],
    version: 1 as const,
  },
  actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
  requestedAt: "2026-08-12T15:00:00.000Z",
  schemaVersion: 1 as const,
};

describe("hosted member action", () => {
  it("round-trips the typed action wake", () => {
    const wake = buildHostedExecutionMemberActionRequestedWake({
      eventId: `member.action.requested:${request.actionId}`,
      memberId: "member-1",
      occurredAt: request.requestedAt,
      request,
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(parseHostedExecutionEvent({
      kind: wake.kind,
      request: wake.request,
      userId: wake.userId,
    })).toEqual({
      kind: wake.kind,
      request,
      userId: wake.userId,
    });
  });

  it("rejects an open or malformed payload", () => {
    expect(() => parseHostedExecutionWake({
      eventId: `member.action.requested:${request.actionId}`,
      kind: "member.action.requested",
      occurredAt: request.requestedAt,
      request: { ...request, token: "not-allowed" },
      userId: "member-1",
    })).toThrow();
  });
});
