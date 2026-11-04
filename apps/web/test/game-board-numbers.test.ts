import { describe, expect, it } from "vitest";
import { BOARD_METRICS, boardNumber, boardCrowns, type BoardMetric, type BoardPerson, type BoardNumber } from "@/src/lib/game/board-numbers";
import type { HostedRuntimeGroupSharedRecord } from "@murphai/hosted-execution/runtime-control";
import { addDays } from "@/src/lib/game/time";
import { pairBoardStreak } from "@/src/lib/game/board-streak";
import type { RuleState } from "@/src/lib/game/rules";

const window = { from: "2030-01-01", through: "2030-03-31" };
const metricKeys = { restingHeartRate: "resting-heart-rate", sleep: "total-sleep-minutes", steps: "steps", vo2Max: "estimated-vo2-max" };
function rows(metric: BoardMetric = "restingHeartRate", source = "oura", from = window.from, count = 7, value = 70, unit = "bpm"): HostedRuntimeGroupSharedRecord[] {
  return Array.from({ length: count }, (_, i) => { const date = addDays(from, i); return {
    data: { date, metricKey: metricKeys[metric], value, unit }, occurredAt: `${date}T00:00:00Z`, recordKey: `${date}:${source}`,
    ...(source ? { source: { source, label: source } } : {}),
  }; });
}
function available(records: HostedRuntimeGroupSharedRecord[], metric: BoardMetric = "restingHeartRate", first = window.from) {
  return boardNumber(metric, { state: "available", records }, window, first);
}
function person(id: string, number: BoardNumber, inARow = 0): BoardPerson {
  return { memberId: id, member: true, me: id === "a", inARow,
    numbers: { restingHeartRate: number, sleep: number, steps: number, vo2Max: number } };
}

describe("pair board numbers", () => {
  it.each(BOARD_METRICS)("preserves unavailable states for %s", metric => {
    for (const [state, expected] of [["not_granted", "not_shared"], ["pending", "pending"], ["missing", "pending"], ["hidden", "hidden"]] as const) {
      expect(boardNumber(metric, { state, records: [] }, window, window.from)).toEqual({ state: expected });
    }
  });
  it("selects a single sufficiently covered source without filling its gaps", () => {
    const points = [...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 4, 60),
      ...rows("restingHeartRate", "garmin", "2030-01-01", 3, 100), ...rows("restingHeartRate", "garmin", "2030-03-25", 7, 20)];
    const number = available(points);
    expect(number).toMatchObject({ state: "available", latest: { date: "2030-03-28", value: 60 }, stale: false,
      comparison: { baseline: { days: 7, value: 70 }, current: { days: 4, value: 60 }, delta: -10, improvement: 10, sinceFirstGame: true } });
    if (number.state === "available") expect(number.daily).toHaveLength(11);
    expect(available([...points].reverse())).toEqual(number);
  });
  it("breaks source ties by latest date then public source id", () => {
    const a = [...rows("restingHeartRate", "a"), ...rows("restingHeartRate", "a", "2030-03-20", 7, 61)];
    const b = [...rows("restingHeartRate", "b"), ...rows("restingHeartRate", "b", "2030-03-21", 7, 62)];
    expect(available([...a, ...b])).toMatchObject({ latest: { value: 62 } });
    const sameDates = [...rows("restingHeartRate", "a"), ...rows("restingHeartRate", "a", "2030-03-21", 7, 61)];
    expect(available([...b, ...sameDates])).toMatchObject({ latest: { value: 61 } });
  });
  it("counts distinct days, rejects overlapping windows and keeps unknown sources display-only", () => {
    const sparse = [...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 3, 60)];
    expect(available([...sparse, ...sparse])).toMatchObject({ comparison: null });
    expect(available(rows("restingHeartRate", "oura", "2030-01-01", 10))).toMatchObject({ comparison: null });
    expect(available([...rows("restingHeartRate", ""), ...rows("restingHeartRate", "", "2030-03-25")])).toMatchObject({ state: "available", comparison: null });
  });
  it("reports stale endpoints and a rolling baseline separately from the true first game", () => {
    expect(available([...rows(), ...rows("restingHeartRate", "oura", "2030-02-20")], "restingHeartRate", "2029-10-01"))
      .toMatchObject({ stale: true, comparison: { sinceFirstGame: false, baseline: { from: window.from } } });
  });
  it("normalizes mixed sleep units before comparison and rounds daily values", () => {
    const records = [...rows("sleep", "oura", window.from, 7, 7.25, "hours"), ...rows("sleep", "oura", "2030-03-25", 7, 470.4, "minutes")];
    const number = available(records, "sleep");
    expect(number).toMatchObject({ unit: "minutes", latest: { value: 470 }, comparison: { baseline: { value: 435 } } });
    if (number.state === "available") expect(number.comparison?.improvement).toBeCloseTo(35.4);
  });
  it("accepts canonical counts and the shared display unit for steps, but excludes nap-only sleep", () => {
    expect(available([...rows("steps", "oura", window.from, 7, 6000, "count"),
      ...rows("steps", "oura", "2030-03-25", 7, 8000, "steps")], "steps"))
      .toMatchObject({ unit: "steps", comparison: { improvement: 2000 } });
    const naps = rows("sleep", "oura", window.from, 7, 40, "minutes").map(record => ({
      ...record, data: { ...record.data, sleepType: "nap" as const },
    }));
    expect(available(naps, "sleep")).toEqual({ state: "pending" });
  });
  it("uses sparse VO2 median policy, two distinct days and a 14-day current window", () => {
    const records = [...rows("vo2Max", "garmin", "2030-01-02", 2, 40, "mL/kg/min"),
      ...rows("vo2Max", "garmin", "2030-03-27", 2, 42.26, "mL/kg/min")];
    expect(available(records, "vo2Max")).toMatchObject({ latest: { value: 42.3 },
      comparison: { baseline: { days: 2, value: 40, through: "2030-03-14" }, current: { from: "2030-03-15", days: 2 }, improvement: expect.closeTo(2.26) } });
    expect(available(records.slice(1), "vo2Max")).toMatchObject({ comparison: null });
  });
  it("awards positive improvement only, with no crown for ties or all-negative changes", () => {
    const positive = available([...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 7, 60)]);
    const negative = available([...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 7, 80)]);
    expect(boardCrowns([person("a", positive, 4), person("b", negative, 2)])).toMatchObject({ restingHeartRate: "a", inARow: "a" });
    expect(Object.values(boardCrowns([person("a", positive, 4), person("b", positive, 4)]))).toEqual([null, null, null, null, null]);
    expect(boardCrowns([person("a", negative), person("b", negative)])).toMatchObject({ restingHeartRate: null, inARow: null });
  });
});

function state(dayOne: string, lengthDays: number, completed: number[], schedule: number[] = [0, 1, 2, 3, 4, 5, 6]): RuleState {
  return { game: { id: dayOne, createdBy: "a", seats: 2, status: "live", lengthDays, startsOn: null, inviteExpiresAt: null,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: schedule.filter((n): n is 0 | 1 | 2 | 3 | 4 | 5 | 6 => n >= 0 && n <= 6) }, stakes: [] }] } },
    players: [{ memberId: "a", seat: 0, dayOne, timeZone: "UTC" }], entries: completed.map(dayIndex => ({
      id: `${dayOne}:${dayIndex}`, memberId: "a", dayIndex, attempt: 1, kind: "words", mediaKeys: [], blurHash: null,
      receivedAt: new Date(`${addDays(dayOne, dayIndex + 1)}T03:30:00Z`), withdrawnAt: null,
    })) };
}
describe("pair board current run", () => {
  const now = new Date("2030-01-08T12:00:00Z");
  it("joins two games, skips off days and leaves today in progress unbroken", () => {
    const first = state("2030-01-01", 4, [0, 1, 2, 3]);
    const next = state("2030-01-05", 4, [2], [0, 1, 2, 3, 4]); // weekend skipped, Monday credited
    expect(pairBoardStreak([{ state: first, now }, { state: next, now }], "a")).toBe(5);
    next.entries.push(...state("2030-01-05", 4, [3]).entries);
    expect(pairBoardStreak([{ state: first, now }, { state: next, now }], "a")).toBe(6);
  });
  it("requires every overlapping obligation and uses canonical credit, never receipt date", () => {
    const first = state("2030-01-01", 8, [0, 1, 2, 3, 4, 5, 6]);
    const overlap = state("2030-01-06", 3, [1]);
    expect(pairBoardStreak([{ state: first, now }, { state: overlap, now }], "a")).toBe(1);
    overlap.entries[0].incomplete = true;
    expect(pairBoardStreak([{ state: first, now }, { state: overlap, now }], "a")).toBe(0);
    overlap.entries[0].incomplete = false;
    overlap.entries[0].withdrawnAt = now;
    expect(pairBoardStreak([{ state: first, now }, { state: overlap, now }], "a")).toBe(0);
    overlap.entries[0].withdrawnAt = null; overlap.entries[0].attempt = 0;
    expect(pairBoardStreak([{ state: first, now }, { state: overlap, now }], "a")).toBe(0);
  });
  it("uses eligibility, changed terms, count mode and the frozen 3am boundary", () => {
    const game = state("2030-01-01", 8, [4, 5, 6]);
    game.game.seats = 10; // exercise the owner's late-seat eligibility primitive
    game.players[0].joinedAt = new Date("2030-01-05T12:00:00Z");
    game.game.terms.versions.push({ n: 2, fromDay: 5, schedule: { count: 3 }, stakes: [] });
    expect(pairBoardStreak([{ state: game, now }], "a")).toBe(3);
    expect(pairBoardStreak([{ state: game, now: new Date("2030-01-09T02:59:00Z") }], "a")).toBe(3);
    expect(pairBoardStreak([{ state: game, now: new Date("2030-01-09T03:00:00Z") }], "a")).toBe(0);
    game.players[0].timeZone = "America/New_York";
    expect(pairBoardStreak([{ state: game, now: new Date("2030-01-09T03:00:00Z") }], "a")).toBe(3);
  });
});
