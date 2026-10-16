import { describe, expect, it } from "vitest";

import { parseGameCommand } from "@/src/lib/game/command";
import { GameRuleError } from "@/src/lib/game/rules";

const PHOTO_KEY = `game/hbm_leo/${"a".repeat(64)}.jpg`;

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof GameRuleError) return error.error.code;
    throw error;
  }
  return "OK";
}

describe("weekly game command validator", () => {
  it("trims words, normalizes the time zone and drops fields it doesn't know", () => {
    expect(parseGameCommand({
      firstName: "  Leo ",
      memberId: "hbm_someone_else",
      timeZone: "america/new_york",
      type: "setProfile",
    })).toEqual({ firstName: "Leo", timeZone: "America/New_York", type: "setProfile" });
  });

  it("builds a challenge with its private invitee label, ignoring client stake keys", () => {
    const created = parseGameCommand({
      gameId: "game_0001",
      inviteeFirstName: "Ava",
      inviteeLabel: { photoKey: PHOTO_KEY, relationship: " girlfriend " },
      terms: {
        schedule: { days: [0, 2, 4] },
        stakes: [{ item: "Breakfast in bed", key: "gsk_mine", kind: "winner_gets" }],
        tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
      },
      type: "createGame",
    });
    expect(created).toMatchObject({
      inviteeLabel: { photoKey: PHOTO_KEY, relationship: "girlfriend" },
      terms: { schedule: { days: [0, 2, 4] } },
    });
    expect(created.type === "createGame" && created.terms.stakes).toEqual([{ item: "Breakfast in bed", kind: "winner_gets" }]);
  });

  it("keeps post text only when there is some, and bounds what a post can carry", () => {
    const post = { entryId: "entry_0001", gameId: "game_0001", kind: "photo", mediaKeys: [PHOTO_KEY], type: "post" };
    expect(parseGameCommand({ ...post, text: "   " })).not.toHaveProperty("text");
    expect(parseGameCommand({ ...post, captureAgeMs: 1500, text: " done " })).toMatchObject({ captureAgeMs: 1500, text: "done" });
    expect(codeOf(() => parseGameCommand({ ...post, kind: "video" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ ...post, mediaKeys: ["../../etc/passwd"] }))).toBe("MEDIA_MISSING");
    expect(codeOf(() => parseGameCommand({ ...post, mediaKeys: Array(5).fill(PHOTO_KEY) }))).toBe("INVALID_REQUEST");
    expect(parseGameCommand({ ...post, data: { route: [1, 2] } })).not.toHaveProperty("data");
    expect(codeOf(() => parseGameCommand({ ...post, captureAgeMs: -1 }))).toBe("INVALID_REQUEST");
  });

  it("rejects unknown commands, bad ids and zones", () => {
    expect(codeOf(() => parseGameCommand({ type: "settle" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ gameId: "game_0001", reason: "cancelled", type: "void" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ entryId: "x", gameId: "game_0001", type: "withdraw" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ firstName: "Leo", timeZone: "Mars/Olympus", type: "setProfile" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand("setProfile"))).toBe("INVALID_REQUEST");
  });
});
