import { describe, expect, it } from "vitest";

import { describeInviteTiming, inviteShareCopy } from "@/app/g/[token]/invite-copy";
import type { GameInvitePreview, GameSchedule } from "@/src/lib/game/contract";

const GROUP: Extract<GameInvitePreview, { status: "open" }> = {
  status: "open", maxPlayers: 10, group: { id: "synthetic-group", word: "family" },
  inviterFirstName: "Leo", lengthDays: 14, startsOn: null, expiresAt: null,
  terms: {
    n: 1, fromDay: 0, defaultTask: "A healthy meal", tasks: [],
    schedule: { days: [0, 1, 2, 3, 4] },
    stakes: [{ kind: "prize", item: "Breakfast in bed" }],
  },
};

describe("invite share copy", () => {
  it("describes an open group with its shared task, schedule, length and prize", () => {
    expect(inviteShareCopy(GROUP)).toEqual({
      title: "Leo started a family challenge",
      description: "A healthy meal every weekday for two weeks. Winner gets Breakfast in bed.",
    });
    expect(JSON.stringify(inviteShareCopy(GROUP))).not.toMatch(/—| - /u);
  });

  it.each<[GameSchedule, number, string]>([
    [{ days: [0, 1, 2, 3, 4, 5, 6] }, 7, "every day for one week"],
    [{ days: [4, 0, 2] }, 10, "on Monday, Wednesday, and Friday for ten days"],
    [{ count: 5 }, 14, "on any five days over two weeks"],
    [{ count: 1 }, 3, "on any one day over three days"],
    [{ count: 50 }, 75, "on any 50 days over 75 days"],
  ])("uses plain schedule and duration words", (schedule, lengthDays, words) => {
    expect(inviteShareCopy({ ...GROUP, lengthDays, terms: { ...GROUP.terms, defaultTask: "A healthy meal.", schedule } }).description)
      .toBe(`A healthy meal ${words}. Winner gets Breakfast in bed.`);
  });

  it.each<GameInvitePreview | null>([
    { status: "used" }, { status: "expired" },
    { status: "expired", reason: "cancelled", inviterFirstName: "Leo" }, null,
  ])("keeps closed group share copy anonymous", (preview) => {
    expect(inviteShareCopy(preview)).toEqual({
      title: "This invite isn't available", description: "Ask for a new link.",
    });
  });

  it("preserves pair copy exactly for both legacy and capable previews", () => {
    for (const maxPlayers of [undefined, 2] as const) {
      expect(inviteShareCopy({ ...GROUP, maxPlayers, group: undefined })).toEqual({
        title: "Leo challenged you", description: "FOR THE WINNER: Breakfast in bed.",
      });
    }
  });

  it.each<[GameSchedule, number | undefined, string | null, string]>([
    [{ days: [0, 1, 2, 3, 4, 5, 6] }, undefined, null, "Every day for a week. Starts once you say yes."],
    [{ days: [0, 1, 2, 3, 4] }, 14, null, "Weekdays for 2 weeks. Starts once you say yes."],
    [{ days: [4, 0, 2] }, 10, "2026-10-19", "Mon, Wed, Fri for 10 days. Starts Oct 19."],
    [{ count: 1 }, 3, null, "Any 1 day in 3 days. Starts once you say yes."],
    [{ count: 50 }, 75, null, "Any 50 days in 75 days. Starts once you say yes."],
  ])("says when a pair game runs the way the app's invite card does", (schedule, lengthDays, startsOn, line) => {
    const pair = { ...GROUP, maxPlayers: 2 as const, group: undefined, lengthDays, startsOn, terms: { ...GROUP.terms, schedule } };
    expect(describeInviteTiming(pair)).toBe(line);
  });

  it("names no start for a group unless one was picked", () => {
    expect(describeInviteTiming(GROUP)).toBe("Weekdays for 2 weeks.");
    expect(describeInviteTiming({ ...GROUP, startsOn: "2026-11-09" })).toBe("Weekdays for 2 weeks. Starts Nov 9.");
  });
});
