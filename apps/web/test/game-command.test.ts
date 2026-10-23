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
  it("validates the challenge check-in requirement and defaults older clients to photos", () => {
    const command = { type: "createGame", gameId: "game_checkin", inviteeFirstName: "Ava", terms: {
      tasks: [{ seat: 0, text: "Pushups" }, { seat: 1, text: "Pushups" }],
      schedule: { count: 3 }, stakes: [{ item: "Coffee", kind: "prize" }],
    } };
    expect(parseGameCommand(command)).toMatchObject({ terms: { checkInKind: "photo" } });
    expect(parseGameCommand({ ...command, terms: { ...command.terms, checkInKind: "heart_rate" } })).toMatchObject({ terms: { checkInKind: "heart_rate" } });
    expect(codeOf(() => parseGameCommand({ ...command, terms: { ...command.terms, checkInKind: "video" } }))).toBe("INVALID_REQUEST");
  });

  it("accepts one rendered heart-rate graph and never admits raw sample fields", () => {
    const command = { type: "post", entryId: "entry_graph1", gameId: "game_0001", kind: "heart_rate", mediaKeys: [PHOTO_KEY] };
    expect(parseGameCommand({ ...command, samples: [{ bpm: 123 }], captureAgeMs: 1500 }))
      .toEqual({ ...command, captureAgeMs: 1500 });
    for (const mediaKeys of [[], [PHOTO_KEY, PHOTO_KEY], [PHOTO_KEY.replace(".jpg", ".heic")]]) {
      expect(codeOf(() => parseGameCommand({ ...command, mediaKeys }))).toBe("INVALID_REQUEST");
    }
  });

  it("trims words, normalizes the time zone and drops fields it doesn't know", () => {
    expect(parseGameCommand({
      firstName: "  Leo ",
      memberId: "hbm_someone_else",
      timeZone: "america/new_york",
      type: "setProfile",
    })).toEqual({ firstName: "Leo", timeZone: "America/New_York", type: "setProfile" });
  });

  it("distinguishes profile photo omission, replacement and removal without requiring unrelated fields", () => {
    expect(parseGameCommand({ type: "setProfile", photoKey: PHOTO_KEY })).toEqual({ type: "setProfile", photoKey: PHOTO_KEY });
    expect(parseGameCommand({ type: "setProfile", photoKey: null })).toEqual({ type: "setProfile", photoKey: null });
    expect(parseGameCommand({ type: "setProfile", firstName: "Ava" })).not.toHaveProperty("photoKey");
    expect(codeOf(() => parseGameCommand({ type: "setProfile" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ type: "setProfile", photoKey: "../photo.jpg" }))).toBe("MEDIA_MISSING");
  });

  it("builds a challenge with its private invitee label, ignoring client stake keys", () => {
    const created = parseGameCommand({
      gameId: "game_0001",
      inviteeFirstName: "Ava",
      inviteeLabel: { photoKey: PHOTO_KEY, relationship: " girlfriend " },
      terms: {
        schedule: { days: [0, 2, 4] },
        stakes: [{ item: "Breakfast in bed", key: "gsk_mine", kind: "prize" }],
        startsOn: "2026-10-19",
        tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
      },
      type: "createGame",
    });
    expect(created).toMatchObject({
      inviteeLabel: { photoKey: PHOTO_KEY, relationship: "girlfriend" },
      terms: { schedule: { days: [0, 2, 4] }, startsOn: "2026-10-19" },
    });
    expect(created.type === "createGame" && created.terms.stakes).toEqual([{ item: "Breakfast in bed", kind: "prize" }]);
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

  it("drops invisible characters from words, but keeps emoji joiners", () => {
    const profile = (firstName: string) => parseGameCommand({ firstName, timeZone: "UTC", type: "setProfile" });
    expect(profile("Le\u200Bo\u0007")).toMatchObject({ firstName: "Leo" });
    expect(profile("\u{1F468}\u200D\u{1F373} Leo")).toMatchObject({ firstName: "\u{1F468}\u200D\u{1F373} Leo" });
    expect(codeOf(() => profile("\u200B\u200D\uFEFF "))).toBe("INVALID_REQUEST");
  });

  it("matches a post's uploads to its kind", () => {
    const post = (kind: string, extension: string) => ({
      entryId: "entry_0001",
      gameId: "game_0001",
      kind,
      mediaKeys: [`game/hbm_leo/${"b".repeat(64)}${extension}`],
      type: "post",
    });
    expect(codeOf(() => parseGameCommand(post("photo", ".jpg")))).toBe("OK");
    expect(codeOf(() => parseGameCommand(post("photo", ".heic")))).toBe("OK");
    expect(codeOf(() => parseGameCommand(post("photo", ".m4a")))).toBe("MEDIA_MISSING");
    expect(codeOf(() => parseGameCommand({ ...post("excuse", ".jpg"), text: "Sick today" }))).toBe("INVALID_REQUEST");
  });

  it("takes an excuse as its transcript only", () => {
    const excuse = { entryId: "entry_0001", gameId: "game_0001", kind: "excuse", type: "post" };
    expect(parseGameCommand({ ...excuse, text: "  Flight was delayed  " })).toEqual({
      entryId: "entry_0001",
      gameId: "game_0001",
      kind: "excuse",
      mediaKeys: [],
      text: "Flight was delayed",
      type: "post",
    });
    expect(codeOf(() => parseGameCommand(excuse))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ ...excuse, text: "\u200B " }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ ...excuse, text: "x".repeat(501) }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ ...excuse, text: "x".repeat(500) }))).toBe("OK");
  });

  it("takes a start date only as a real calendar date", () => {
    const create = (startsOn: unknown) => ({
      gameId: "game_0001",
      inviteeFirstName: "Ava",
      terms: { schedule: { count: 3 }, stakes: [], startsOn, tasks: [{ seat: 0, text: "Run" }, { seat: 1, text: "Swim" }] },
      type: "createGame",
    });
    expect(codeOf(() => parseGameCommand(create("2026-02-30")))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand(create("2026-10-19T00:00:00Z")))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand(create(20261019)))).toBe("INVALID_REQUEST");
  });

  it("rejects unknown commands, bad ids and zones", () => {
    expect(codeOf(() => parseGameCommand({ type: "settle" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ gameId: "game_0001", reason: "cancelled", type: "void" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ entryId: "x", gameId: "game_0001", type: "withdraw" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand({ firstName: "Leo", timeZone: "Mars/Olympus", type: "setProfile" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => parseGameCommand("setProfile"))).toBe("INVALID_REQUEST");
  });
});
