import { describe, expect, it } from "vitest";

import { decideHostedGroupJoinOutreachSendWindow } from "@/src/lib/hosted-groups/group-join-outreach-window";

describe("hosted group join outreach recipient window", () => {
  it("uses a conservative safe window for a supported non-NANP calling code", () => {
    expect(decideHostedGroupJoinOutreachSendWindow({
      now: new Date("2026-07-24T12:00:00.000Z"),
      participantPhoneNumber: "+445550123456",
    })).toEqual({ kind: "send_now" });
  });

  it("keeps an ambiguous international recipient pending instead of dropping it", () => {
    const now = new Date("2026-07-24T16:00:00.000Z");

    expect(decideHostedGroupJoinOutreachSendWindow({
      now,
      participantPhoneNumber: "+9795550123",
    })).toEqual({
      kind: "defer",
      nextAttemptAt: new Date("2026-07-25T16:00:00.000Z"),
      reason: "recipient_timezone_unavailable",
    });
  });
});
