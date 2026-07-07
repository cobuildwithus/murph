import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readCallCircleCalendarAvailability,
} from "@/src/lib/call-circle/free-busy";
import {
  proposeCallCircleMatches,
} from "@/src/lib/call-circle/matcher";
import {
  isWithinCallCircleQuietHours,
  listUpcomingCallCircleWindows,
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
        }, ["member_dan"]),
        participant("member_dan", {
          dayOfWeek: 1,
          endLocalTime: "17:00",
          startLocalTime: "15:00",
        }),
      ],
      recentMatches: [],
    })).toEqual([{
      memberAId: "member_alice",
      memberBId: "member_bob",
      windowEndAt: new Date("2026-07-06T16:00:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    }]);
  });

  it("excludes pairs that matched during the seven-day lookback", () => {
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
        status: "completed",
        windowStartAt: new Date("2026-07-05T15:00:00.000Z"),
      }],
    })).toEqual([]);
  });

  it("rotates away from each participant's last partner even after the weekly cooldown", () => {
    const now = new Date("2026-07-06T13:00:00.000Z");
    const lastMatchedAt = new Date("2026-06-28T13:00:00.000Z");
    const sharedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "16:00",
      startLocalTime: "14:00",
    };

    expect(proposeCallCircleMatches({
      now,
      participants: [
        participantWithLastPartner("member_alice", sharedWindow, "member_bob", lastMatchedAt),
        participantWithLastPartner("member_bob", sharedWindow, "member_alice", lastMatchedAt),
        participantWithLastPartner("member_cara", sharedWindow, "member_dan", lastMatchedAt),
        participantWithLastPartner("member_dan", sharedWindow, "member_cara", lastMatchedAt),
      ],
      recentMatches: [],
    })).toEqual([
      {
        memberAId: "member_alice",
        memberBId: "member_cara",
        windowEndAt: new Date("2026-07-06T16:00:00.000Z"),
        windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
      },
      {
        memberAId: "member_bob",
        memberBId: "member_dan",
        windowEndAt: new Date("2026-07-06T16:00:00.000Z"),
        windowStartAt: new Date("2026-07-06T14:00:00.000Z"),
      },
    ]);
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
      windowEndAt: new Date("2026-07-06T09:00:00.000Z"),
      windowStartAt: new Date("2026-07-06T08:30:00.000Z"),
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

  it("clamps same-day windows to now and respects quiet-hour send windows", () => {
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
    })).toEqual([{
      endAt: new Date("2026-07-06T16:00:00.000Z"),
      startAt: now,
    }]);
    expect(isWithinCallCircleQuietHours({
      now: new Date("2026-07-06T12:00:00.000Z"),
      timeZone: "UTC",
    })).toBe(true);
    expect(isWithinCallCircleQuietHours({
      now: new Date("2026-07-06T02:00:00.000Z"),
      timeZone: "UTC",
    })).toBe(false);
  });
});

describe("Call Circle connected-apps free-busy read", () => {
  it("returns busy when any connected calendar reports a conflict", async () => {
    const requests: unknown[] = [];
    const requester = {
      async request(input: {
        memberId: string;
        request: unknown;
      }): Promise<unknown> {
        requests.push(input);
        if (
          typeof input.request === "object"
          && input.request !== null
          && "input" in input.request
          && typeof input.request.input === "object"
          && input.request.input !== null
          && "action" in input.request.input
        ) {
          return {
            accounts: [{
              id: "calendar_1",
              status: "ACTIVE",
              toolkit: { slug: "googlecalendar" },
            }],
          };
        }
        return requests.length === 2 ? { busy: [] } : { busy: [{ start: "2026-07-06T15:00:00Z" }] };
      },
    };

    await expect(readCallCircleCalendarAvailability({
      endAt: new Date("2026-07-06T15:30:00.000Z"),
      memberId: "member_123",
      requester,
      startAt: new Date("2026-07-06T15:00:00.000Z"),
      timeZone: "UTC",
    })).resolves.toBe("busy");

    expect(requests).toHaveLength(3);
    expect(readExecutedToolSlugs(requests)).toEqual([
      "GOOGLECALENDAR_FREE_BUSY_QUERY",
      "GOOGLECALENDAR_FIND_FREE_SLOTS",
    ]);
  });

  it("does not call event-listing tools or parse event payloads as availability", async () => {
    const requests: unknown[] = [];
    const requester = {
      async request(input: {
        memberId: string;
        request: unknown;
      }): Promise<unknown> {
        requests.push(input);
        if (
          typeof input.request === "object"
          && input.request !== null
          && "input" in input.request
          && typeof input.request.input === "object"
          && input.request.input !== null
          && "action" in input.request.input
        ) {
          return {
            accounts: [{
              id: "calendar_1",
              status: "ACTIVE",
              toolkit: { slug: "googlecalendar" },
            }],
          };
        }
        return {
          events: [{
            description: "busy planning",
            start: "2026-07-06T15:00:00Z",
            summary: "Private event",
          }],
        };
      },
    };

    await expect(readCallCircleCalendarAvailability({
      endAt: new Date("2026-07-06T15:30:00.000Z"),
      memberId: "member_123",
      requester,
      startAt: new Date("2026-07-06T15:00:00.000Z"),
      timeZone: "UTC",
    })).resolves.toBe("unknown");

    expect(readExecutedToolSlugs(requests)).toEqual([
      "GOOGLECALENDAR_FREE_BUSY_QUERY",
      "GOOGLECALENDAR_FIND_FREE_SLOTS",
    ]);
  });

  it("fails open to unknown when connected-apps reads are unavailable", async () => {
    await expect(readCallCircleCalendarAvailability({
      endAt: new Date("2026-07-06T15:30:00.000Z"),
      memberId: "member_123",
      requester: {
        async request(): Promise<unknown> {
          throw new Error("connected apps unavailable");
        },
      },
      startAt: new Date("2026-07-06T15:00:00.000Z"),
      timeZone: "UTC",
    })).resolves.toBe("unknown");
  });
});

function participant(
  memberId: string,
  window: {
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    endLocalTime: string;
    startLocalTime: string;
  },
  excludeMemberIds: string[] = [],
) {
  return {
    lastMatchedAt: null,
    memberId,
    preferences: {
      excludeMemberIds,
      windows: [window],
    },
    timeZone: "UTC",
  };
}

function participantWithLastPartner(
  memberId: string,
  window: {
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    endLocalTime: string;
    startLocalTime: string;
  },
  lastPartnerMemberId: string,
  lastMatchedAt: Date,
) {
  return {
    ...participant(memberId, window),
    lastMatchedAt,
    lastPartnerMemberId,
  };
}

function readExecutedToolSlugs(requests: readonly unknown[]): string[] {
  return requests.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const request = entry.request;
    if (!isRecord(request)) return [];
    const input = request.input;
    if (!isRecord(input)) return [];
    const toolSlug = input.toolSlug;
    return typeof toolSlug === "string" ? [toolSlug] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
