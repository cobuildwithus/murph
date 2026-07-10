import { describe, expect, it } from "vitest";

import {
  hostedCallCirclePreferencesSchema,
  hostedCallCircleRespondControlRequestSchema,
  hostedCallCircleRespondRequestSchema,
  hostedCallCircleRespondResponseSchema,
  isHostedCallCircleTimeZone,
} from "../src/call-circle.js";

describe("hosted Call Circle contracts", () => {
  it("exposes the shared IANA timezone validator", () => {
    expect(isHostedCallCircleTimeZone("America/New_York")).toBe(true);
    expect(isHostedCallCircleTimeZone("not/a-timezone")).toBe(false);
  });

  it("parses member preference responses", () => {
    expect(hostedCallCircleRespondRequestSchema.parse({
      kind: "preferences",
      timeZone: "America/New_York",
      windows: [
        {
          dayOfWeek: 2,
          endLocalTime: "18:00",
          startLocalTime: "17:00",
        },
      ],
    })).toEqual({
      kind: "preferences",
      timeZone: "America/New_York",
      windows: [
        {
          dayOfWeek: 2,
          endLocalTime: "18:00",
          startLocalTime: "17:00",
        },
      ],
    });
  });

  it("defaults old stored preferences to weekly cadence with no member overrides", () => {
    expect(hostedCallCirclePreferencesSchema.parse({
      timeZone: "America/New_York",
      windows: [],
    })).toEqual({
      cadence: "weekly",
      memberCadences: [],
      timeZone: "America/New_York",
      windows: [],
    });
  });

  it("uses one contextual control-plane envelope", () => {
    expect(hostedCallCircleRespondControlRequestSchema.parse({
      request: { kind: "confirm" },
    })).toEqual({ request: { kind: "confirm" } });
    expect(() => hostedCallCircleRespondControlRequestSchema.parse({
      kind: "confirm",
    })).toThrow(/request/u);
  });

  it("allows independent default and per-member cadence updates", () => {
    expect(hostedCallCircleRespondRequestSchema.parse({
      cadence: "monthly",
      kind: "preferences",
      memberCadenceUpdates: [
        { cadence: "never", memberId: "member_housemate" },
        { cadence: "weekly", memberId: "member_friend" },
      ],
    })).toEqual({
      cadence: "monthly",
      kind: "preferences",
      memberCadenceUpdates: [
        { cadence: "never", memberId: "member_housemate" },
        { cadence: "weekly", memberId: "member_friend" },
      ],
    });
  });

  it("rejects empty or duplicate per-member preference updates", () => {
    expect(() => hostedCallCircleRespondRequestSchema.parse({
      kind: "preferences",
    })).toThrow(/change at least one setting/u);
    expect(() => hostedCallCircleRespondRequestSchema.parse({
      kind: "preferences",
      memberCadenceUpdates: [
        { cadence: "never", memberId: "member_housemate" },
        { cadence: "default", memberId: "member_housemate" },
      ],
    })).toThrow(/at most once/u);
  });

  it("rejects unknown stored preference fields", () => {
    expect(() => hostedCallCirclePreferencesSchema.parse({
      excludedMemberIds: ["member_legacy"],
      timeZone: "America/New_York",
      windows: [],
    })).toThrow(/Unrecognized key/u);
  });

  it("allows lifecycle replies without explicit match identity", () => {
    expect(hostedCallCircleRespondRequestSchema.parse({
      kind: "confirm",
    })).toEqual({
      kind: "confirm",
    });
  });

  it("parses counter windows and bounded responses", () => {
    expect(hostedCallCircleRespondRequestSchema.parse({
      counterWindow: {
        endAt: "2026-07-08T22:30:00.000Z",
        startAt: "2026-07-08T22:00:00.000Z",
      },
      kind: "counter",
    }).kind).toBe("counter");

    expect(hostedCallCircleRespondResponseSchema.parse({
      status: "ok",
    })).toEqual({ status: "ok" });
    expect(hostedCallCircleRespondResponseSchema.parse({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    })).toEqual({
      status: "unavailable",
      unavailableReason: "call_circle_match_unavailable",
    });
    expect(() => hostedCallCircleRespondResponseSchema.parse({
      status: "unavailable",
    })).toThrow(/unavailableReason/u);
    expect(() => hostedCallCircleRespondResponseSchema.parse({
      status: "ok",
      unavailableReason: "not allowed",
    })).toThrow(/Unrecognized key/u);
  });

  it("rejects model-supplied response targets", () => {
    expect(() => hostedCallCircleRespondRequestSchema.parse({
      kind: "confirm",
      matchId: "hccm_123",
    })).toThrow(/Unrecognized key/u);
  });
});
