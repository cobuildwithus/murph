import { describe, expect, it } from "vitest";

import {
  memberActionRequestV1Schema,
  parseMemberActionRequestV1,
} from "../src/member-action.ts";

function validRequest() {
  return {
    action: {
      expectedWorkout: {
        actionBinding: "a".repeat(64),
        exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
      },
      kind: "workout.live.apply" as const,
      mutations: [
        {
          exerciseName: "Leg press",
          exercisePosition: 1,
          expectedResult: null,
          kind: "set.put" as const,
          requiresExistingSet: true,
          result: {
            kind: "weight_reps" as const,
            reps: 8,
            weight: 180,
            weightUnit: "lb" as const,
          },
          setPosition: 1,
        },
      ],
      version: 1 as const,
    },
    actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    requestedAt: "2026-08-12T15:00:00.000Z",
    schemaVersion: 1 as const,
  };
}

describe("member action contract", () => {
  it("parses a closed, versioned workout action", () => {
    const request = validRequest();

    expect(parseMemberActionRequestV1(request)).toEqual(request);
  });

  it("rejects unknown fields and invalid action identities", () => {
    expect(memberActionRequestV1Schema.safeParse({
      ...validRequest(),
      token: "not-part-of-the-contract",
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...validRequest(),
      actionId: "retry-1",
    }).success).toBe(false);
  });

  it("bounds workout shape and mutations", () => {
    const request = validRequest();
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout: {
          actionBinding: request.action.expectedWorkout.actionBinding,
          exercises: Array.from({ length: 9 }, (_, index) => ({
            name: `Exercise ${index + 1}`,
            sets: [{ logged: false }],
          })),
        },
      },
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [],
      },
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: Array.from(
          { length: 72 },
          () => request.action.mutations[0],
        ),
      },
    }).success).toBe(true);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: Array.from(
          { length: 73 },
          () => request.action.mutations[0],
        ),
      },
    }).success).toBe(false);
  });

  it("rejects a previous result for a set that is expected to be new", () => {
    const request = validRequest();
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [{
          ...request.action.mutations[0],
          expectedResult: { kind: "reps", reps: 7 },
          requiresExistingSet: false,
        }],
      },
    }).success).toBe(false);
  });
});
