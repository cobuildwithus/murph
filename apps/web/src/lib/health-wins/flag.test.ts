import { describe, expect, it } from "vitest";
import {
  healthFeedAuthors, healthRecordCapability, healthWinTextMemberIds, isHealthDietEnabled, isHealthFeedEnabled,
  isHealthPayoffEnabled, isHealthWinTextEnabled,
} from "./flag";

const on = { MURPH_GAME_ENABLED: "true" };

describe("health allowlists", () => {
  it("names members, or every member with *", () => {
    const listed = { ...on, MURPH_HEALTH_FEED_MEMBER_IDS: " member-a , member-b " };
    expect(isHealthFeedEnabled("member-b", listed)).toBe(true);
    expect(isHealthFeedEnabled("member-c", listed)).toBe(false);
    expect(healthFeedAuthors(listed)).toEqual(["member-a", "member-b"]);
    const everyone = { ...on, MURPH_HEALTH_FEED_MEMBER_IDS: "*" };
    expect(isHealthFeedEnabled("member-c", everyone)).toBe(true);
    expect(healthFeedAuthors(everyone)).toBe("everyone");
  });

  it("stays off when games are off or the list is empty", () => {
    const gamesOff = { MURPH_GAME_ENABLED: "false", MURPH_HEALTH_FEED_MEMBER_IDS: "*" };
    expect(isHealthFeedEnabled("member-a", gamesOff)).toBe(false);
    expect(healthFeedAuthors(gamesOff)).toEqual([]);
    expect(isHealthFeedEnabled("member-a", { ...on, MURPH_HEALTH_FEED_MEMBER_IDS: " , " })).toBe(false);
  });

  it("layers recording and routes on the feed, each with *", () => {
    const all = { ...on, MURPH_HEALTH_FEED_MEMBER_IDS: "*", MURPH_HEALTH_RECORD_MEMBER_IDS: "*" };
    expect(healthRecordCapability("member-a", all)).toEqual({ timed: true, route: false, named: true });
    expect(healthRecordCapability("member-a", { ...all, MURPH_HEALTH_ROUTE_MEMBER_IDS: "*" }))
      .toEqual({ timed: true, route: true, named: true });
    expect(healthRecordCapability("member-a", { ...all, MURPH_HEALTH_RECORD_MEMBER_IDS: "" })).toBeUndefined();
    expect(healthRecordCapability("member-a", { ...all, MURPH_HEALTH_FEED_MEMBER_IDS: "member-b" })).toBeUndefined();
  });

  it.each([
    ["MURPH_HEALTH_DIET_MEMBER_IDS", isHealthDietEnabled],
    ["MURPH_HEALTH_PAYOFF_MEMBER_IDS", isHealthPayoffEnabled],
    ["MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", isHealthWinTextEnabled],
  ] as const)("requires the feed and an independent %s grant", (key, enabled) => {
    const feed = { ...on, MURPH_HEALTH_FEED_MEMBER_IDS: "member-a" };
    expect(enabled("member-a", feed)).toBe(false);
    expect(enabled("member-a", { ...feed, [key]: "member-b" })).toBe(false);
    expect(enabled("member-a", { ...feed, [key]: " member-b , member-a " })).toBe(true);
    expect(enabled("member-a", { ...feed, [key]: "*" })).toBe(true);
    expect(enabled("member-b", { ...feed, [key]: "*" })).toBe(false);
    expect(enabled("member-a", { ...feed, [key]: "*", MURPH_GAME_ENABLED: "false" })).toBe(false);
  });

  it("enumerates named text recipients and pages all enrollments when * appears", () => {
    const listed = {
      ...on,
      MURPH_HEALTH_FEED_MEMBER_IDS: "member-a,member-b",
      MURPH_HEALTH_WIN_TEXT_MEMBER_IDS: " member-b, ,member-c,member-b ",
    };
    expect(healthWinTextMemberIds(listed)).toEqual(["member-b"]);
    expect(healthWinTextMemberIds({ ...listed, MURPH_HEALTH_FEED_MEMBER_IDS: "*" })).toEqual(["member-b", "member-c"]);
    expect(healthWinTextMemberIds({ ...listed, MURPH_HEALTH_WIN_TEXT_MEMBER_IDS: undefined })).toEqual([]);
    const wildcard = { ...listed, MURPH_HEALTH_WIN_TEXT_MEMBER_IDS: " member-b , * " };
    expect(healthWinTextMemberIds(wildcard)).toBe("everyone");
    expect(isHealthWinTextEnabled("member-a", wildcard)).toBe(true);
    expect(isHealthWinTextEnabled("member-c", wildcard)).toBe(false);
    expect(healthWinTextMemberIds({ ...wildcard, MURPH_GAME_ENABLED: "false" })).toEqual([]);
    expect(healthWinTextMemberIds({ ...wildcard, MURPH_HEALTH_FEED_MEMBER_IDS: "" })).toEqual([]);
  });
});
