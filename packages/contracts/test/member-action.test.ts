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

  it("accepts pull-up and push-up results as typed reps", () => {
    const request = {
      ...validRequest(),
      action: {
        ...validRequest().action,
        expectedWorkout: {
          actionBinding: "a".repeat(64),
          exercises: [
            { name: "Pull-ups", sets: [{ logged: false }] },
            { name: "Push-ups", sets: [{ logged: false }] },
          ],
        },
        mutations: [
          {
            exerciseName: "Pull-ups",
            exercisePosition: 1,
            expectedResult: null,
            kind: "set.put" as const,
            result: { kind: "reps" as const, reps: 6 },
            setPosition: 1,
          },
          {
            exerciseName: "Push-ups",
            exercisePosition: 2,
            expectedResult: null,
            kind: "set.put" as const,
            result: { kind: "reps" as const, reps: 15 },
            setPosition: 1,
          },
        ],
      },
    };

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
        mutations: [
          ...Array.from({ length: 8 }, (_, index) => ({
            exercisePosition: index + 1,
            kind: "exercise.append" as const,
            mode: null,
            name: `Exercise ${index + 1}`,
            setCount: 1,
            unitOverride: null,
          })),
          ...Array.from({ length: 64 }, (_, index) => ({
            ...request.action.mutations[0],
            exercisePosition: Math.floor(index / 8) + 1,
            setPosition: (index % 8) + 1,
          })),
        ],
      },
    }).success).toBe(true);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout: {
          ...request.action.expectedWorkout,
          exercises: [{ name: "Leg press", sets: [{ logged: true }] }],
        },
        mutations: [{
          ...request.action.mutations[0],
          expectedResult: {
            kind: "note",
            note: "n".repeat(400),
          },
          result: { kind: "note", note: "corrected" },
        }],
      },
    }).success).toBe(true);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout: {
          ...request.action.expectedWorkout,
          exercises: [{ name: "Leg press", sets: [{ logged: true }] }],
        },
        mutations: [{
          ...request.action.mutations[0],
          expectedResult: {
            kind: "weight_reps",
            reps: 1e100,
            weight: 1e100,
            weightUnit: null,
          },
        }],
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

  it("requires new sets to append contiguously after retained sets", () => {
    const request = validRequest();
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [{
          exerciseName: "Leg press",
          exercisePosition: 1,
          kind: "set.append",
          result: null,
          setPosition: 3,
        }],
      },
    }).success).toBe(false);
  });

  it("requires existing-set updates to own one consistent field family", () => {
    const request = validRequest();
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [{
          ...request.action.mutations[0],
          result: null,
        }],
      },
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [{
          ...request.action.mutations[0],
          expectedResult: { kind: "note", note: "Previous note" },
        }],
      },
    }).success).toBe(false);
  });

  it("represents exact partial prior fields separately from a strict result", () => {
    const request = validRequest();
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout: {
          ...request.action.expectedWorkout,
          exercises: [{ name: "Leg press", sets: [{ logged: true }] }],
        },
        mutations: [{
          ...request.action.mutations[0],
          expectedResult: {
            kind: "weight_reps",
            reps: 8,
            weight: null,
            weightUnit: null,
          },
        }],
      },
    }).success).toBe(true);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout: {
          ...request.action.expectedWorkout,
          exercises: [{ name: "Leg press", sets: [{ logged: true }] }],
        },
        mutations: [{
          ...request.action.mutations[0],
          expectedResult: {
            kind: "weight_reps",
            reps: 0,
            weight: 0,
            weightUnit: null,
          },
        }],
      },
    }).success).toBe(true);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [{
          ...request.action.mutations[0],
          result: {
            kind: "weight_reps",
            reps: 0,
            weight: 0,
            weightUnit: "lb",
          },
        }],
      },
    }).success).toBe(false);
  });

  it("accepts a set removal only with its exact visible state", () => {
    const request = validRequest();
    const expectedWorkout = {
      ...request.action.expectedWorkout,
      exercises: [{
        name: "Leg press",
        sets: [{ logged: false }, { logged: true }],
      }],
      setRemovalBinding: "b".repeat(64),
    };
    const removal = {
      exerciseName: "Leg press",
      exercisePosition: 1,
      expectedSets: [
        { logged: false, result: null },
        { logged: true, result: { kind: "reps" as const, reps: 8 } },
      ],
      kind: "set.remove" as const,
      setPosition: 2,
    };
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: { ...request.action, expectedWorkout, mutations: [removal] },
    }).success).toBe(true);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout,
        mutations: [
          removal,
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            kind: "set.append",
            result: request.action.mutations[0].result,
            setPosition: 2,
          },
        ],
      },
    }).success).toBe(true);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout,
        mutations: [{
          ...removal,
          expectedSets: [{
            logged: true,
            result: { kind: "reps", reps: 8 },
          }],
        }],
      },
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout,
        mutations: [{
          ...removal,
          setPosition: 3,
        }],
      },
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout,
        mutations: [{
          ...removal,
          expectedSets: [
            { logged: true, result: null },
            { logged: true, result: { kind: "reps", reps: 8 } },
          ],
        }],
      },
    }).success).toBe(false);
  });

  it("rejects a destructive batch whose final visible sequence matches its prestate", () => {
    const request = validRequest();
    const expectedSets = [
      { logged: true, result: { kind: "reps" as const, reps: 10 } },
      { logged: true, result: { kind: "reps" as const, reps: 10 } },
      { logged: true, result: { kind: "reps" as const, reps: 10 } },
    ];
    const expectedWorkout = {
      ...request.action.expectedWorkout,
      exercises: [{
        name: "Leg press",
        sets: expectedSets.map(({ logged }) => ({ logged })),
      }],
      setRemovalBinding: "b".repeat(64),
    };
    const removal = {
      exerciseName: "Leg press",
      exercisePosition: 1,
      expectedSets,
      kind: "set.remove" as const,
      setPosition: 1,
    };
    const append = {
      exerciseName: "Leg press",
      exercisePosition: 1,
      kind: "set.append" as const,
      result: { kind: "reps" as const, reps: 10 },
      setPosition: 3,
    };

    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout,
        mutations: [removal, append],
      },
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        expectedWorkout,
        mutations: [
          removal,
          {
            ...append,
            result: { kind: "reps" as const, reps: 12 },
          },
        ],
      },
    }).success).toBe(true);
  });

  it("rejects duplicate mutation targets so exact replay has one postcondition", () => {
    const request = validRequest();
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [
          request.action.mutations[0],
          {
            ...request.action.mutations[0],
            result: { kind: "weight_reps", reps: 6, weight: 200, weightUnit: "lb" },
          },
        ],
      },
    }).success).toBe(false);
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [
          request.action.mutations[0],
          {
            exerciseName: "Leg press",
            exercisePosition: 1,
            expectedSets: [
              { logged: false, result: null },
              { logged: false, result: null },
            ],
            kind: "set.remove",
            setPosition: 1,
          },
        ],
      },
    }).success).toBe(false);

    const append = {
      exercisePosition: 2,
      kind: "exercise.append" as const,
      mode: null,
      name: "Push-up",
      setCount: 1,
      unitOverride: null,
    };
    expect(memberActionRequestV1Schema.safeParse({
      ...request,
      action: {
        ...request.action,
        mutations: [append, append],
      },
    }).success).toBe(false);
  });
});
