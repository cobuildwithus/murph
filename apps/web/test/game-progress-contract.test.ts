import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  friendsSchema, goalsSchema, healthSchema, progressSchema,
  parseFriendsQuery, parseGoalsQuery, parseMapQuery, parsePicUploadQuery,
  parseSeenBody, parseSetMeasureBody, parseSetSharingBody,
} from "../src/lib/game/progress/contract";
import { READERS } from "../src/lib/game/progress/registry";

const directory = path.join(import.meta.dirname, "fixtures/progress");
const schemas = { progress: progressSchema, health: healthSchema, friends: friendsSchema, goals: goalsSchema };

describe("Progress wire fixtures", () => {
  it.each(readdirSync(directory).filter(name => name.endsWith(".json")))("decodes the complete %s response", name => {
    const key = name.split("-")[0] as keyof typeof schemas;
    const fixture: unknown = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
    const decoded = schemas[key].parse(fixture);
    expect(decoded).toEqual(fixture); // No dropped fields or decoder defaults.
    if ("medals" in decoded) {
      expect(decoded.medals.filter(medal => medal.gold).length).toBeLessThanOrEqual(1);
      const ids = new Set(decoded.medals.map(medal => medal.id));
      expect(ids.size).toBe(decoded.medals.length);
      expect(decoded.shelf.every(id => ids.has(id))).toBe(true);
      expect(decoded.moments.flatMap(moment => moment.medalIds).every(id => ids.has(id))).toBe(true);
    }
    if ("rows" in decoded) {
      for (const row of decoded.rows.filter(row => row.private)) {
        expect(row.rank).toBeNull(); expect(row.total).toBeNull();
        expect(decoded.chart.some(line => line.memberId === row.memberId)).toBe(false);
        expect(decoded.next?.memberId).not.toBe(row.memberId);
      }
    }
  });
  it("preserves the year board's medal counts and the two pushup units", () => {
    const year = progressSchema.parse(JSON.parse(readFileSync(path.join(directory, "progress-row09-year.json"), "utf8")));
    expect(year.medals).toHaveLength(148);
    expect(Object.fromEntries(["landmark", "friend", "health", "streak", "total"].map(kind => [kind, year.medals.filter(m => m.kind === kind).length])))
      .toEqual({ landmark: 102, friend: 4, health: 31, streak: 3, total: 8 });
    const units = progressSchema.parse(JSON.parse(readFileSync(path.join(directory, "progress-row15-two-units.json"), "utf8")));
    expect(units.measures.map(m => [m.id, m.total.text])).toEqual([["pushups.reps", "1,400"], ["pushups.seconds", "2h 40m"]]);
  });
  it("rejects a private friend carrying an amount or rank", () => {
    const fixture = friendsSchema.parse(JSON.parse(readFileSync(path.join(directory, "friends-row16-private.json"), "utf8")));
    expect(() => friendsSchema.parse({ ...fixture, rows: fixture.rows.map(row => row.private
      ? { ...row, rank: 6, total: { value: 88000, text: "88k", unit: "steps" } } : row) })).toThrow();
  });
});

describe("Progress request boundary", () => {
  it.each([
    [{ goal: { rungId: " empire-state-building " } }, { goal: { rungId: "empire-state-building" } }],
    [{ goal: { from: "London", to: "New York" } }, { goal: { from: "London", to: "New York" } }],
    [{ perDay: 40 }, { perDay: 40 }],
  ])("accepts one measure edit: %j", (body, expected) => {
    expect(parseSetMeasureBody(body)).toEqual(expected);
  });
  it.each([{}, null, { perDay: 0 }, { perDay: -1 }, { perDay: Infinity }, { perDay: "40" },
    { goal: { rungId: "" } }, { goal: { from: "London" } }, { goal: { rungId: "a", from: "b", to: "c" } },
    { perDay: 40, goal: { rungId: "a" } }, { perDay: 40, memberId: "foreign" },
  ])("rejects malformed or ambiguous measure edits: %j", body => expect(() => parseSetMeasureBody(body)).toThrow("Invalid Progress request."));
  it.each([
    [parseSetSharingBody, { metrics: ["steps", "sleep"], share: true }],
    [parseSeenBody, { momentIds: ["moment-one"] }],
    [parseGoalsQuery, { measure: "pushups.reps", q: "Half Dome" }],
    [parsePicUploadQuery, { id: "10000000-0000-4000-8000-000000000001", measureId: "pushups.reps", takenAt: "2026-11-14T12:00:00Z" }],
  ] as const)("accepts the typed boundary input", (parse, input) => expect(parse(input)).toEqual(input));
  it.each([
    [parseSetSharingBody, { metrics: ["restingHeartRate"], share: true }],
    [parseSetSharingBody, { metrics: [], share: true }],
    [parseSetSharingBody, { metrics: ["steps"], share: "true" }],
    [parseSeenBody, { momentIds: [3] }],
    [parsePicUploadQuery, { id: "not-a-uuid", measureId: "pushups.reps", takenAt: "2026-11-14" }],
    [parseMapQuery, { measure: "walk.meters", w: "-1", h: "400" }],
  ] as const)("rejects malformed boundary input", (parse, input) => expect(() => parse(input)).toThrow("Invalid Progress request."));
  it("defaults the friends range", () => {
    expect(parseFriendsQuery({ measure: "steps", with: "member-leo" })).toEqual({ measure: "steps", range: "month", with: "member-leo" });
  });
  it.each(["card", "drawer"])("accepts only the named %s map size for measures and previews", size => {
    expect(parseMapQuery({ measure: "walk.meters", size })).toEqual({ measure: "walk.meters", size });
    expect(parseMapQuery({ from: "London", to: "New York", size })).toEqual({ from: "London", to: "New York", size });
  });
  it.each([
    { from: "London", to: "New York", measure: "steps", size: "card" },
    { measure: "walk.meters", w: "708", h: "405" },
    { measure: "walk.meters", size: "card", w: "708" },
    { measure: "walk.meters", size: "poster" },
    { from: "London", to: "Paris", size: "poster" },
    { from: "London", size: "card" }, { measure: "steps" },
  ])("rejects invalid map queries: %j", input => expect(() => parseMapQuery(input)).toThrow("Invalid Progress request."));
  it("typed readers name their own measure and preserve canonical units", () => {
    const [reps, route] = READERS;
    expect([reps.measureId({ exercise: "pushups", count: 40, reps: [] }), reps.amount({ exercise: "pushups", count: 40, reps: [] })]).toEqual(["pushups.reps", 40]);
    expect([route.measureId({ activity: "run", distanceM: 1609.344, durationSec: 600 }), route.amount({ activity: "run", distanceM: 1609.344, durationSec: 600 })]).toEqual(["run.meters", 1609.344]);
  });
});
