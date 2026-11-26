import { describe, expect, it } from "vitest";
import { healthFeedAuthors, healthRecordCapability, isHealthFeedEnabled } from "./flag";

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
    expect(healthRecordCapability("member-a", all)).toEqual({ timed: true, route: false });
    expect(healthRecordCapability("member-a", { ...all, MURPH_HEALTH_ROUTE_MEMBER_IDS: "*" }))
      .toEqual({ timed: true, route: true });
    expect(healthRecordCapability("member-a", { ...all, MURPH_HEALTH_FEED_MEMBER_IDS: "member-b" })).toBeUndefined();
  });
});
