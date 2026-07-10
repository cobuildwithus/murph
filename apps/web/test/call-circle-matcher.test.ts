import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  proposeCallCircleMatches,
  type CallCircleMatcherParticipant,
} from "@/src/lib/call-circle/matcher";
import {
  isWithinCallCircleDaytime,
  listUpcomingCallCircleWindows,
  localDateTimeToUtc,
  readNextCallCircleMatchingAt,
} from "@/src/lib/call-circle/time";

describe("Call Circle matching and time windows", () => {
  it("proposes deterministic pairs only when participants share an eligible window", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", {
          dayOfWeek: 1,
          endLocalTime: "16:00",
          startLocalTime: "14:00",
        }),
        participant("member_bob", {
          dayOfWeek: 1,
          endLocalTime: "17:00",
          startLocalTime: "15:00",
        }),
        participant("member_cara", {
          dayOfWeek: 1,
          endLocalTime: "17:00",
          startLocalTime: "15:00",
        }),
        participant("member_dan", {
          dayOfWeek: 1,
          endLocalTime: "17:00",
          startLocalTime: "15:00",
        }),
      ],
      recentMatches: [],
    })).toEqual([
      {
        memberAId: "member_alice",
        memberBId: "member_bob",
        windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      {
        memberAId: "member_cara",
        memberBId: "member_dan",
        windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
    ]);
  });

  it("canonicalizes opaque ids with code-unit order", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_a", sharedWindow),
        participant("member_Z", sharedWindow),
      ],
      recentMatches: [],
    })[0]).toMatchObject({
      memberAId: "member_Z",
      memberBId: "member_a",
    });
  });

  it("narrows broad availability blocks to the authorized call window", () => {
    const now = new Date("2026-07-06T07:00:00.000Z");

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", {
          dayOfWeek: 1,
          endLocalTime: "17:00",
          startLocalTime: "09:00",
        }),
        participant("member_bob", {
          dayOfWeek: 1,
          endLocalTime: "17:00",
          startLocalTime: "09:00",
        }),
      ],
      recentMatches: [],
    })).toEqual([{
      memberAId: "member_alice",
      memberBId: "member_bob",
      windowEndAt: new Date("2026-07-06T09:15:00.000Z"),
      windowStartAt: new Date("2026-07-06T09:00:00.000Z"),
    }]);
  });

  it("excludes pairs that matched during the weekly lookback", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", {
          dayOfWeek: 1,
          endLocalTime: "16:00",
          startLocalTime: "14:00",
        }),
        participant("member_bob", {
          dayOfWeek: 1,
          endLocalTime: "16:00",
          startLocalTime: "14:00",
        }),
      ],
      recentMatches: [{
        createdAt: new Date("2026-07-05T13:00:00.000Z"),
        memberAId: "member_bob",
        memberBId: "member_alice",
      }],
    })).toEqual([]);
  });

  it("always blocks a participant with an open match even past the cadence window", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", sharedWindow),
        participant("member_bob", sharedWindow),
      ],
      recentMatches: [{
        createdAt: new Date("2026-04-01T13:00:00.000Z"),
        memberAId: "member_alice",
        memberBId: "member_other",
        open: true,
      }],
    })).toEqual([]);
  });

  it("uses cadence slack so the next weekly run is not decided by cron jitter", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", sharedWindow),
        participant("member_bob", sharedWindow),
      ],
      recentMatches: [{
        createdAt: new Date("2026-06-30T00:00:00.000Z"),
        memberAId: "member_alice",
        memberBId: "member_bob",
      }],
    })).toHaveLength(1);
  });

  it("uses the slower private cadence and lets default clear back to rotation", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };
    const alice = participant("member_alice", sharedWindow);
    alice.preferences.memberCadences = [{
      cadence: "monthly",
      memberId: "member_bob",
    }];
    const recentMatches = [{
      createdAt: new Date("2026-06-15T13:00:00.000Z"),
      memberAId: "member_alice",
      memberBId: "member_bob",
    }];

    expect(proposeCallCircleMatches({
      now,
      participants: [alice, participant("member_bob", sharedWindow)],
      recentMatches,
    })).toEqual([]);

    alice.preferences.memberCadences = [];
    expect(proposeCallCircleMatches({
      now,
      participants: [alice, participant("member_bob", sharedWindow)],
      recentMatches,
    })).toHaveLength(1);
  });

  it("lets a weekly person override opt into a faster pair than the default", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };
    const alice = participant("member_alice", sharedWindow);
    alice.preferences.cadence = "monthly";
    alice.preferences.memberCadences = [{
      cadence: "weekly",
      memberId: "member_bob",
    }];

    expect(proposeCallCircleMatches({
      now,
      participants: [alice, participant("member_bob", sharedWindow)],
      recentMatches: [{
        createdAt: new Date("2026-06-29T13:00:00.000Z"),
        memberAId: "member_alice",
        memberBId: "member_bob",
      }],
    })).toHaveLength(1);
  });

  it("enforces every-other-week cadence with the same jitter margin", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };
    const alice = participant("member_alice", sharedWindow);
    alice.preferences.cadence = "biweekly";
    const bob = participant("member_bob", sharedWindow);
    bob.preferences.cadence = "biweekly";

    expect(proposeCallCircleMatches({
      now,
      participants: [alice, bob],
      recentMatches: [{
        createdAt: new Date("2026-06-24T13:00:00.000Z"),
        memberAId: "member_alice",
        memberBId: "member_bob",
      }],
    })).toEqual([]);
    expect(proposeCallCircleMatches({
      now,
      participants: [alice, bob],
      recentMatches: [{
        createdAt: new Date("2026-06-23T00:00:00.000Z"),
        memberAId: "member_alice",
        memberBId: "member_bob",
      }],
    })).toHaveLength(1);
  });

  it("rotates away from each participant's last partner even after the weekly cooldown", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const previousMatchAt = new Date("2026-06-28T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", sharedWindow),
        participant("member_bob", sharedWindow),
        participant("member_cara", sharedWindow),
        participant("member_dan", sharedWindow),
      ],
      recentMatches: [
        {
          createdAt: previousMatchAt,
          memberAId: "member_alice",
          memberBId: "member_bob",
        },
        {
          createdAt: previousMatchAt,
          memberAId: "member_cara",
          memberBId: "member_dan",
        },
      ],
    })).toEqual([
      {
        memberAId: "member_alice",
        memberBId: "member_cara",
        windowEndAt: new Date("2026-07-06T14:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
      },
      {
        memberAId: "member_bob",
        memberBId: "member_dan",
        windowEndAt: new Date("2026-07-06T14:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
      },
    ]);
  });

  it("treats either member's private never cadence as a pair veto and keeps matching", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };
    const alice = participant("member_alice", sharedWindow);
    alice.preferences.memberCadences = [{
      cadence: "never",
      memberId: "member_bob",
    }];

    expect(proposeCallCircleMatches({
      now,
      participants: [
        alice,
        participant("member_bob", sharedWindow),
        participant("member_cara", sharedWindow),
        participant("member_dan", sharedWindow),
      ],
      recentMatches: [],
    })).toEqual([
      {
        memberAId: "member_alice",
        memberBId: "member_cara",
        windowEndAt: new Date("2026-07-06T14:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
      },
      {
        memberAId: "member_bob",
        memberBId: "member_dan",
        windowEndAt: new Date("2026-07-06T14:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
      },
    ]);
  });

  it("honors a private never veto from the second member in canonical pair order", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };
    const bob = participant("member_bob", sharedWindow);
    bob.preferences.memberCadences = [{
      cadence: "never",
      memberId: "member_alice",
    }];

    expect(proposeCallCircleMatches({
      now,
      participants: [participant("member_alice", sharedWindow), bob],
      recentMatches: [],
    })).toEqual([]);
  });

  it("shifts early local windows until the confirmation flow has a morning ask slot", () => {
    const now = new Date("2026-07-06T07:00:00.000Z");

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", {
          dayOfWeek: 1,
          endLocalTime: "09:00",
          startLocalTime: "08:00",
        }),
        participant("member_bob", {
          dayOfWeek: 1,
          endLocalTime: "09:00",
          startLocalTime: "08:00",
        }),
      ],
      recentMatches: [],
    })).toEqual([{
      memberAId: "member_alice",
      memberBId: "member_bob",
      windowEndAt: new Date("2026-07-06T08:55:00.000Z"),
      windowStartAt: new Date("2026-07-06T08:40:00.000Z"),
    }]);
  });

  it("skips early local windows that are too short after the final ask lead", () => {
    const now = new Date("2026-07-06T07:00:00.000Z");

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", {
          dayOfWeek: 1,
          endLocalTime: "08:30",
          startLocalTime: "08:00",
        }),
        participant("member_bob", {
          dayOfWeek: 1,
          endLocalTime: "08:30",
          startLocalTime: "08:00",
        }),
      ],
      recentMatches: [],
    })).toEqual([]);
  });

  it("continues to a later overlap when the first cannot fit the confirmation flow", () => {
    const now = new Date("2026-07-06T07:50:00.000Z");
    const windows = [
      {
        dayOfWeek: 1 as const,
        endLocalTime: "08:20",
        startLocalTime: "08:00",
      },
      {
        dayOfWeek: 2 as const,
        endLocalTime: "13:00",
        startLocalTime: "12:00",
      },
    ];

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", windows),
        participant("member_bob", windows),
      ],
      recentMatches: [],
    })).toEqual([{
      memberAId: "member_alice",
      memberBId: "member_bob",
      windowEndAt: new Date("2026-07-07T12:15:00.000Z"),
      windowStartAt: new Date("2026-07-07T12:00:00.000Z"),
    }]);
  });

  it("does not schedule a call that starts after the daytime boundary", () => {
    const now = new Date("2026-07-06T20:30:00.000Z");

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_alice", {
          dayOfWeek: 1,
          endLocalTime: "21:40",
          startLocalTime: "21:10",
        }),
        participant("member_bob", {
          dayOfWeek: 1,
          endLocalTime: "21:40",
          startLocalTime: "21:10",
        }),
      ],
      recentMatches: [],
    })).toEqual([]);
  });

  it("clamps same-day windows to now and respects daytime send windows", () => {
    const now = new Date("2026-07-06T15:30:00.000Z");

    expect(listUpcomingCallCircleWindows({
      availability: {
        timeZone: "UTC",
        windows: [{
          dayOfWeek: 1,
          endLocalTime: "16:00",
          startLocalTime: "15:00",
        }],
      },
      now,
    })).toEqual([
      {
        endAt: new Date("2026-07-06T16:00:00.000Z"),
        startAt: now,
      },
      {
        endAt: new Date("2026-07-13T16:00:00.000Z"),
        startAt: new Date("2026-07-13T15:00:00.000Z"),
      },
    ]);
    expect(isWithinCallCircleDaytime({
      now: new Date("2026-07-06T12:00:00.000Z"),
      timeZone: "UTC",
    })).toBe(true);
    expect(isWithinCallCircleDaytime({
      now: new Date("2026-07-06T02:00:00.000Z"),
      timeZone: "UTC",
    })).toBe(false);
  });

  it("includes next week's local weekday after today's window has passed", () => {
    expect(listUpcomingCallCircleWindows({
      availability: {
        timeZone: "America/Los_Angeles",
        windows: [{
          dayOfWeek: 0,
          endLocalTime: "10:00",
          startLocalTime: "09:00",
        }],
      },
      now: new Date("2026-07-06T00:00:00.000Z"),
    })).toEqual([{
      endAt: new Date("2026-07-12T17:00:00.000Z"),
      startAt: new Date("2026-07-12T16:00:00.000Z"),
    }]);
  });

  it("fails closed for invalid time zones", () => {
    expect(listUpcomingCallCircleWindows({
      availability: {
        timeZone: "Not/A_Time_Zone",
        windows: [{
          dayOfWeek: 1,
          endLocalTime: "16:00",
          startLocalTime: "15:00",
        }],
      },
      now: new Date("2026-07-06T12:00:00.000Z"),
    })).toEqual([]);
    expect(isWithinCallCircleDaytime({
      now: new Date("2026-07-06T12:00:00.000Z"),
      timeZone: "Not/A_Time_Zone",
    })).toBe(false);
  });

  it("skips nonexistent spring-forward wall-clock windows", () => {
    expect(localDateTimeToUtc({
      day: 8,
      hour: 2,
      minute: 30,
      month: 3,
      year: 2026,
    }, "America/New_York")).toBeNull();

    expect(listUpcomingCallCircleWindows({
      availability: {
        timeZone: "America/New_York",
        windows: [{
          dayOfWeek: 0,
          endLocalTime: "03:30",
          startLocalTime: "02:30",
        }],
      },
      daysAhead: 2,
      now: new Date("2026-03-07T12:00:00.000Z"),
    })).toEqual([]);
  });

  it("chooses the earlier instant for an ambiguous fall-back wall-clock minute", () => {
    expect(localDateTimeToUtc({
      day: 1,
      hour: 1,
      minute: 30,
      month: 11,
      year: 2026,
    }, "America/New_York")).toEqual(new Date("2026-11-01T05:30:00.000Z"));
  });

  it("advances matching to a fixed Monday UTC epoch", () => {
    expect(readNextCallCircleMatchingAt(
      new Date("2026-07-06T00:00:00.000Z"),
    )).toEqual(new Date("2026-07-13T00:00:00.000Z"));
    expect(readNextCallCircleMatchingAt(
      new Date("2026-07-09T18:00:00.000Z"),
    )).toEqual(new Date("2026-07-13T00:00:00.000Z"));
  });
});

interface CallCircleTestWindow {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  endLocalTime: string;
  startLocalTime: string;
}

function participant(
  memberId: string,
  windowOrWindows: CallCircleTestWindow | readonly CallCircleTestWindow[],
): CallCircleMatcherParticipant {
  return {
    memberId,
    preferences: {
      cadence: "weekly",
      memberCadences: [],
      timeZone: "UTC",
      windows: Array.isArray(windowOrWindows) ? windowOrWindows : [windowOrWindows],
    },
  };
}
