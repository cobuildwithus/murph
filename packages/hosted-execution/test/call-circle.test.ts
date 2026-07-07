import { describe, expect, it } from "vitest";

import {
  hostedCallCircleRespondRequestSchema,
  hostedCallCircleRespondResponseSchema,
} from "../src/call-circle.js";

describe("hosted Call Circle contracts", () => {
  it("parses member preference responses", () => {
    expect(hostedCallCircleRespondRequestSchema.parse({
      excludeMemberIds: ["member_2"],
      groupId: "hgrp_123",
      kind: "preferences",
      windows: [
        {
          dayOfWeek: 2,
          endLocalTime: "18:00",
          startLocalTime: "17:00",
        },
      ],
    })).toEqual({
      excludeMemberIds: ["member_2"],
      groupId: "hgrp_123",
      kind: "preferences",
      windows: [
        {
          dayOfWeek: 2,
          endLocalTime: "18:00",
          startLocalTime: "17:00",
        },
      ],
    });
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
      groupId: "hgrp_123",
      kind: "counter",
      matchId: "hccm_123",
      side: "A",
    }).kind).toBe("counter");

    expect(hostedCallCircleRespondResponseSchema.parse({
      status: "ok",
    })).toEqual({ status: "ok" });
  });
});
