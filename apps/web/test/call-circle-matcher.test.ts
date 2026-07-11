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

  it("finds a maximum-cardinality pairing when the first eligible edge is a dead end", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const edgeAB = testWindow("14:00");
    const edgeAC = testWindow("15:00");
    const edgeBD = testWindow("16:00");
    const participants = [
      participant("member_a", [edgeAB, edgeAC]),
      participant("member_b", [edgeAB, edgeBD]),
      participant("member_c", edgeAC),
      participant("member_d", edgeBD),
    ];
    const expected = [
      {
        memberAId: "member_a",
        memberBId: "member_c",
        windowEndAt: new Date("2026-07-06T15:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
      },
      {
        memberAId: "member_b",
        memberBId: "member_d",
        windowEndAt: new Date("2026-07-06T16:15:00.000Z"),
        windowStartAt: new Date("2026-07-06T16:00:00.000Z"),
      },
    ];

    expect(proposeCallCircleMatches({
      now,
      participants,
      recentMatches: [],
    })).toEqual(expected);
    expect(proposeCallCircleMatches({
      now,
      participants: [...participants].reverse(),
      recentMatches: [],
    })).toEqual(expected);
  });

  it("handles an odd-cycle candidate graph without losing a pair", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const edgeAB = testWindow("14:00");
    const edgeAC = testWindow("15:00");
    const edgeBC = testWindow("16:00");
    const edgeCD = testWindow("17:00");

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participant("member_a", [edgeAB, edgeAC]),
        participant("member_b", [edgeAB, edgeBC]),
        participant("member_c", [edgeAC, edgeBC, edgeCD]),
        participant("member_d", edgeCD),
      ],
      recentMatches: [],
    })).toEqual([
      expect.objectContaining({ memberAId: "member_a", memberBId: "member_b" }),
      expect.objectContaining({ memberAId: "member_c", memberBId: "member_d" }),
    ]);
  });

  it("matches the brute-force maximum cardinality for every five-member graph", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const memberIds = Array.from({ length: 5 }, (_, index) => `member_${index}`);
    const completeEdges: Array<readonly [number, number]> = [];
    for (let first = 0; first < memberIds.length; first += 1) {
      for (let second = first + 1; second < memberIds.length; second += 1) {
        completeEdges.push([first, second]);
      }
    }

    for (let graphMask = 0; graphMask < 2 ** completeEdges.length; graphMask += 1) {
      const includedEdges = completeEdges.filter(
        (_edge, edgeIndex) => (graphMask & (1 << edgeIndex)) !== 0,
      );
      const windowsByMember = memberIds.map(() => [] as CallCircleTestWindow[]);
      for (const edge of includedEdges) {
        const edgeIndex = completeEdges.indexOf(edge);
        const hour = 14 + Math.floor(edgeIndex / 2);
        const minute = edgeIndex % 2 === 0 ? "00" : "30";
        const window = testWindow(`${String(hour).padStart(2, "0")}:${minute}`);
        windowsByMember[edge[0]]?.push(window);
        windowsByMember[edge[1]]?.push(window);
      }

      const proposals = proposeCallCircleMatches({
        now,
        participants: memberIds.map((memberId, index) =>
          participant(memberId, windowsByMember[index] ?? [])),
        recentMatches: [],
      });

      expect(proposals, `candidate graph mask ${graphMask}`).toHaveLength(
        bruteForceMaximumMatchingSize(memberIds.length, includedEdges),
      );
    }
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

  it("uses a repeat when avoiding it would reduce maximum cardinality", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const edgeAB = testWindow("14:00");
    const edgeAC = testWindow("15:00");
    const edgeCD = testWindow("16:00");
    const proposals = proposeCallCircleMatches({
      now,
      participants: [
        participant("member_a", [edgeAB, edgeAC]),
        participant("member_b", edgeAB),
        participant("member_c", [edgeAC, edgeCD]),
        participant("member_d", edgeCD),
      ],
      recentMatches: [{
        createdAt: new Date("2026-06-28T13:00:00.000Z"),
        memberAId: "member_a",
        memberBId: "member_b",
      }],
    });

    expect(proposals).toHaveLength(2);
    expect(proposals.map((proposal) =>
      `${proposal.memberAId}:${proposal.memberBId}`
    ).sort()).toEqual([
      "member_a:member_b",
      "member_c:member_d",
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

function testWindow(startLocalTime: string): CallCircleTestWindow {
  const [hourText, minuteText] = startLocalTime.split(":");
  const hour = Number.parseInt(hourText ?? "", 10);
  const minute = Number.parseInt(minuteText ?? "", 10) + 30;
  const endHour = hour + Math.floor(minute / 60);
  return {
    dayOfWeek: 1,
    endLocalTime: `${String(endHour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    startLocalTime,
  };
}

function bruteForceMaximumMatchingSize(
  vertexCount: number,
  edges: readonly (readonly [number, number])[],
): number {
  const search = (edgeIndex: number, usedMask: number): number => {
    const edge = edges[edgeIndex];
    if (!edge) return 0;
    const withoutEdge = search(edgeIndex + 1, usedMask);
    const edgeMask = (1 << edge[0]) | (1 << edge[1]);
    if ((usedMask & edgeMask) !== 0) return withoutEdge;
    return Math.max(
      withoutEdge,
      1 + search(edgeIndex + 1, usedMask | edgeMask),
    );
  };

  if (vertexCount > 30) {
    throw new Error("Brute-force matching test supports at most 30 vertices.");
  }
  return search(0, 0);
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
