import { describe, expect, it } from "vitest";
import { BOARD_METRICS, boardNumber, boardCrowns, type BoardMetric, type BoardPerson, type BoardNumber } from "@/src/lib/game/board-numbers";
import type { HostedRuntimeGroupSharedRecord } from "@murphai/hosted-execution/runtime-control";
import { addDays } from "@/src/lib/game/time";
import { pairBoardStreak } from "@/src/lib/game/board-streak";
import type { RuleState } from "@/src/lib/game/rules";
import { lastSettledStepDay } from "@/src/lib/settled-step-day";

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
    for (const [state, expected] of [["not_granted", "not_shared"], ["pending", "pending"]] as const) {
      expect(boardNumber(metric, { state, records: [] }, window, window.from)).toEqual({ state: expected });
    }
    expect(boardNumber(metric, { state: "missing", records: [] }, window, window.from))
      .toEqual({ state: "pending", reason: "no_readings" });
    expect(available([], metric)).toEqual({ state: "pending", reason: "no_readings" });
    expect(available(rows(metric, "manual", window.from, 1, 52, "invalid-unit"), metric))
      .toEqual({ state: "pending", reason: "no_readings" });
  });
  it("selects a single sufficiently covered source without filling its gaps", () => {
    const points = [...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 4, 60),
      ...rows("restingHeartRate", "garmin", "2030-01-01", 3, 100), ...rows("restingHeartRate", "garmin", "2030-03-25", 7, 20)];
    const number = available(points);
    expect(number).toMatchObject({ state: "available", source: "oura", latest: { date: "2030-03-28", value: 60 }, stale: false,
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
  it("keeps overlapping Fitbit and Google Health steps on one board source", () => {
    const records = [
      ...rows("steps", "fitbit", window.from, 14, 6000, "count"),
      ...rows("steps", "google_health", window.from, 14, 4100, "count"),
    ];
    const number = available(records, "steps");
    expect(number).toMatchObject({ state: "available" });
    if (number.state !== "available") throw new Error("Expected board steps");
    expect(number.daily).toHaveLength(14);
    expect(number.daily.every((point) => point.value === 6000 || point.value === 4100)).toBe(true);
    expect(number.daily.some((point) => point.value === 10100)).toBe(false);
  });
  it("shows current Google Health steps after a formerly comparable Fitbit source stops reporting", () => {
    const records = [
      ...rows("steps", "fitbit", "2029-11-02", 60, 6000, "count"),
      ...rows("steps", "fitbit", "2030-03-14", 10, 8000, "count"),
      ...rows("steps", "google-health", "2030-03-28", 4, 4100, "count"),
    ];
    expect(available(records.filter((record) => record.source?.source === "fitbit"), "steps", "2030-01-01"))
      .toMatchObject({ source: "fitbit", stale: true, comparison: expect.any(Object) });
    const number = available(records, "steps", "2030-01-01");
    expect(number).toMatchObject({
      state: "available",
      source: "google-health",
      latest: { date: "2030-03-31", value: 4100 },
      stale: false,
      comparison: null,
    });
    if (number.state !== "available") throw new Error("Expected board steps");
    expect(number.daily).toHaveLength(4);
  });
  it("counts distinct days, rejects overlapping windows and keeps unknown sources display-only", () => {
    const sparse = [...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 3, 60)];
    expect(available([...sparse, ...sparse])).toMatchObject({ comparison: null });
    expect(available(rows("restingHeartRate", "oura", "2030-01-01", 10))).toMatchObject({ comparison: null });
    expect(available([...rows("restingHeartRate", ""), ...rows("restingHeartRate", "", "2030-03-25")])).toMatchObject({ state: "available", comparison: null });
    expect(available([...rows("restingHeartRate", ""), ...rows("restingHeartRate", "", "2030-03-25")])).not.toHaveProperty("source");
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
    expect(available(naps, "sleep")).toEqual({ state: "pending", reason: "no_readings" });
  });
  it.each([
    ["07:00:00", "2026-11-03", 8000, 14],
    ["08:00:00", "2026-11-04", 4000, 15],
  ])("excludes unsettled step days at %s local but retains today's heart rate", (time, settledThrough, latestValue, days) => {
    const now = new Date(`2026-11-05T${time}-05:00`);
    const currentWindow = { from: "2026-08-08", through: "2026-11-05" };
    const stepsWindow = { ...currentWindow, through: lastSettledStepDay(now, "America/New_York") };
    const records = [...rows("steps", "garmin", currentWindow.from, 7, 6000, "count"),
      ...rows("steps", "garmin", "2026-10-28", 7, 8000, "count"),
      ...rows("steps", "garmin", "2026-11-04", 1, 4000, "count"),
      ...rows("steps", "garmin", "2026-11-05", 1, 1000, "count")];
    const number = boardNumber("steps", { state: "available", records }, stepsWindow, currentWindow.from);
    expect(number).toMatchObject({ state: "available", latest: { date: settledThrough, value: latestValue }, stale: false,
      comparison: { baseline: { from: currentWindow.from, value: 6000, days: 7 },
        current: { from: addDays(settledThrough, -6), through: settledThrough, days: 7 }, sinceFirstGame: true } });
    if (number.state !== "available") throw new Error("Expected settled steps");
    expect(number.daily).toHaveLength(days);
    expect(number.daily.every(point => point.date <= settledThrough)).toBe(true);
    expect(number.comparison?.current.value).toBeCloseTo(time === "07:00:00" ? 8000 : (6 * 8000 + 4000) / 7);
    expect(number.comparison?.improvement).toBeCloseTo(time === "07:00:00" ? 2000 : (6 * 8000 + 4000) / 7 - 6000);
    expect(boardNumber("restingHeartRate", { state: "available", records: rows("restingHeartRate", "oura", "2026-11-05", 1, 59) },
      currentWindow, currentWindow.from)).toMatchObject({ latest: { date: "2026-11-05", value: 59 }, daily: [{ date: "2026-11-05", value: 59 }] });
    for (const age of [7, 8]) {
      expect(boardNumber("steps", { state: "available", records: rows("steps", "garmin", addDays(settledThrough, -age), 1, 8000, "count") },
        stepsWindow, currentWindow.from)).toMatchObject({ stale: age > 7, comparison: null });
    }
  });
  it("uses sparse VO2 median policy, two distinct days and a 14-day current window", () => {
    const records = [...rows("vo2Max", "garmin", "2030-01-02", 2, 40, "mL/kg/min"),
      ...rows("vo2Max", "garmin", "2030-03-27", 2, 42.26, "mL/kg/min")];
    expect(available(records, "vo2Max")).toMatchObject({ latest: { value: 42.3 },
      comparison: { baseline: { days: 2, value: 40, through: "2030-03-14" }, current: { from: "2030-03-15", days: 2 }, improvement: expect.closeTo(2.26) } });
    expect(available(records.slice(1), "vo2Max")).toMatchObject({ comparison: null });
  });
  it.each([0, 10, 45, 46])("shows one member-reported VO2 reading from %s days ago without a comparison", age => {
    const date = addDays(window.through, -age);
    expect(available(rows("vo2Max", "manual", date, 1, 52, "mL/kg/min"), "vo2Max")).toEqual({
      state: "available", unit: "ml/kg/min", source: "manual", latest: { date, value: 52 },
      daily: [{ date, value: 52 }], stale: age > 45, comparison: null,
    });
  });
  it("awards positive improvement only, with no crown for ties or all-negative changes", () => {
    const positive = available([...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 7, 60)]);
    const negative = available([...rows(), ...rows("restingHeartRate", "oura", "2030-03-25", 7, 80)]);
    expect(boardCrowns([person("a", positive, 4), person("b", negative, 2)])).toMatchObject({ restingHeartRate: "a", inARow: "a" });
    expect(Object.values(boardCrowns([person("a", positive, 4), person("b", positive, 4)]))).toEqual([null, null, null, null, null]);
    expect(boardCrowns([person("a", negative), person("b", negative)])).toMatchObject({ restingHeartRate: null, inARow: null });
  });
});

describe("pair board baseline", () => {
  const first = "2030-01-21"; // Day 1, with its 60 pre-game days reaching behind `window`
  const preGameFrom = addDays(first, -60);
  const preGame = (value = 70) => rows("restingHeartRate", "oura", preGameFrom, 60, value);
  const readings = (from: string, count: number, value = 60) => rows("restingHeartRate", "oura", from, count, value);
  it("compares with the mean of the full 60 days before Day 1 and keeps daily inside the window", () => {
    const number = available([...rows("restingHeartRate", "oura", "2029-11-01", 3, 200), ...preGame(), ...readings(first, 60)], "restingHeartRate", first);
    expect(number).toMatchObject({ state: "available", latest: { date: "2030-03-21", value: 60 }, comparison: {
      baseline: { from: preGameFrom, through: addDays(first, -1), value: 70, days: 60 },
      current: { from: "2030-03-15", through: "2030-03-21", value: 60, days: 7 },
      delta: -10, improvement: 10, sinceFirstGame: true } });
    if (number.state !== "available") throw new Error("Expected a number");
    expect(number.daily).toHaveLength(80);
    expect(number.daily[0]?.date).toBe(window.from);
  });
  it("keeps the current week on or after Day 1, so the chip can appear on the fourth reading", () => {
    expect(available([...preGame(), ...readings(first, 3)], "restingHeartRate", first)).toMatchObject({ comparison: null });
    expect(available([...preGame(), ...readings(first, 4)], "restingHeartRate", first)).toMatchObject({ comparison: {
      baseline: { through: addDays(first, -1) }, current: { from: first, through: addDays(first, 3), days: 4 }, sinceFirstGame: true } });
    expect(available([...preGame(), ...readings(first, 10)], "restingHeartRate", first)).toMatchObject({ comparison: {
      current: { from: addDays(first, 3), through: addDays(first, 9), days: 7 } } });
    expect(available(preGame(), "restingHeartRate", first)).toMatchObject({ latest: { date: addDays(first, -1) }, comparison: null });
  });
  it("falls back to the first week when the pre-game days are under the minimum", () => {
    const records = [...rows("restingHeartRate", "oura", addDays(first, -3), 3, 200), ...readings(first, 7, 70)];
    expect(available([...records, ...readings("2030-03-25", 7)], "restingHeartRate", first)).toMatchObject({ comparison: {
      baseline: { from: first, through: addDays(first, 6), value: 70, days: 7 }, current: { days: 7, value: 60 }, sinceFirstGame: true } });
    expect(available(readings(first, 13), "restingHeartRate", first)).toMatchObject({ comparison: null });
    expect(available(readings(first, 14), "restingHeartRate", first)).toMatchObject({ comparison: {
      baseline: { through: addDays(first, 6) }, current: { from: addDays(first, 7) } } });
  });
  it("starts the fallback at the first real reading, for every metric, and names that date", () => {
    const connected = addDays(first, 4);
    const expected = { baseline: { from: connected, through: addDays(connected, 6), days: 7 }, current: { from: addDays(connected, 7) }, sinceFirstGame: false };
    expect(available(readings(connected, 14), "restingHeartRate", first)).toMatchObject({ comparison: expected });
    expect(available(readings(connected, 13), "restingHeartRate", first)).toMatchObject({ comparison: null });
    expect(available(rows("sleep", "oura", connected, 14, 420, "minutes"), "sleep", first)).toMatchObject({ comparison: expected });
    expect(available(rows("steps", "garmin", connected, 14, 8000, "count"), "steps", first)).toMatchObject({ comparison: expected });
    expect(available(rows("vo2Max", "garmin", connected, 16, 40, "mL/kg/min"), "vo2Max", first)).toMatchObject({ comparison: { baseline: { from: connected }, sinceFirstGame: false } });
  });
  it("keeps today's results on a snapshot that holds only the window's 90 days", () => {
    const week = [...rows("restingHeartRate", "oura", window.from, 90, 70)];
    expect(available(week, "restingHeartRate", first)).toMatchObject({ comparison: {
      baseline: { from: preGameFrom, through: addDays(first, -1), days: 20 }, sinceFirstGame: true } });
    const older = "2029-12-20"; // Day 1 before the snapshot starts, with nothing to read before it
    expect(available(week, "restingHeartRate", older)).toMatchObject({ comparison: {
      baseline: { from: window.from, through: "2030-01-07", days: 7 }, sinceFirstGame: false } });
    const edge = "2030-01-03"; // two pre-game days in the snapshot, under the minimum
    expect(available(week, "restingHeartRate", edge)).toMatchObject({ comparison: { baseline: { from: edge, days: 7 }, sinceFirstGame: true } });
  });
  it("clips a baseline at the retained edge and leaves a first game beyond reach to the oldest week", () => {
    const records = rows("restingHeartRate", "oura", "2029-10-03", 180, 70);
    expect(available(records, "restingHeartRate", "2029-11-01")).toMatchObject({ comparison: {
      baseline: { from: "2029-10-03", through: "2029-10-31", days: 29 }, sinceFirstGame: true } });
    expect(available(records, "restingHeartRate", "2029-07-01")).toMatchObject({ comparison: {
      baseline: { from: "2029-10-03", through: "2029-10-09", days: 7 }, sinceFirstGame: false } });
  });
  it("gives a source with no reading inside the window no row", () => {
    const old = rows("restingHeartRate", "garmin", preGameFrom, 40, 90);
    expect(available(old, "restingHeartRate", first)).toEqual({ state: "pending", reason: "no_readings" });
    expect(available([...old, ...readings(first, 2)], "restingHeartRate", first)).toMatchObject({
      latest: { value: 60 }, daily: [{ value: 60 }, { value: 60 }] });
  });
  it("keeps VO2's median and two-reading minimum, on the same pre-game window and a clipped 14-day current", () => {
    const vo2 = (from: string, value: number, count = 1) => rows("vo2Max", "garmin", from, count, value, "mL/kg/min");
    const before = [...vo2(addDays(first, -50), 40), ...vo2(addDays(first, -20), 44)];
    expect(available([...before, ...vo2(addDays(first, 1), 45, 2)], "vo2Max", first)).toMatchObject({ comparison: {
      baseline: { from: preGameFrom, through: addDays(first, -1), days: 2, value: 42 },
      current: { from: first, through: addDays(first, 2), days: 2, value: 45 }, sinceFirstGame: true } });
    expect(available([...before, ...vo2(addDays(first, 1), 45)], "vo2Max", first)).toMatchObject({ comparison: null });
    expect(available([...vo2(addDays(first, -20), 44), ...vo2(first, 40, 2), ...vo2(addDays(first, 40), 45, 2)], "vo2Max", first)).toMatchObject({ comparison: {
      baseline: { from: first, through: addDays(first, 27), days: 2, value: 40 }, current: { days: 2, value: 45 }, sinceFirstGame: true } });
  });
});

describe("pair board steps", () => {
  const first = "2030-03-01";
  const steps = (source: string, from: string, count: number, value: number) => rows("steps", source, from, count, value, "count");
  const at = (through: string, records: HostedRuntimeGroupSharedRecord[]) => {
    const asOf = { from: addDays(through, -89), through };
    return boardNumber("steps", { state: "available", records: records.filter(record => record.occurredAt.slice(0, 10) <= through) }, asOf, first);
  };
  it("drops 0-step days from the baseline, the current week and daily, for steps only", () => {
    const records = [...steps("garmin", addDays(first, -60), 55, 8000), ...steps("garmin", addDays(first, -5), 5, 0),
      ...steps("garmin", first, 19, 9000), ...steps("garmin", addDays(first, 19), 1, 0)];
    const number = at(addDays(first, 19), records);
    expect(number).toMatchObject({ latest: { date: addDays(first, 18), value: 9000 }, comparison: {
      baseline: { value: 8000, days: 55 }, current: { through: addDays(first, 18), value: 9000, days: 7 }, improvement: 1000 } });
    if (number.state !== "available") throw new Error("Expected steps");
    expect(number.daily.every(point => point.value > 0)).toBe(true);
    expect(at(addDays(first, 19), steps("garmin", first, 20, 0))).toEqual({ state: "pending", reason: "no_readings" });
    expect(available(rows("sleep", "oura", window.from, 3, 0, "minutes"), "sleep")).toMatchObject({ latest: { value: 0 } });
  });
  it("stays on a worn device whose zeros end mid-game, with no comparison or crown until its week clears", () => {
    const real = addDays(first, 10);
    const records = [...steps("whoop", addDays(first, -60), 70, 0), ...steps("whoop", real, 7, 8000), ...steps("whoop", addDays(real, 7), 30, 9000),
      ...steps("apple-health-kit", addDays(first, -60), 110, 15000)];
    const rival = available([], "steps");
    const crown = (number: BoardNumber) => boardCrowns([person("a", number), person("b", rival)]).steps;
    const onWorn = (number: BoardNumber) => {
      if (number.state !== "available") throw new Error("Expected steps");
      expect(number.daily.every(point => point.value < 15000)).toBe(true);
      expect(number.daily[0]?.date).toBe(real);
    };
    for (const age of [3, 6, 12]) {
      const number = at(addDays(real, age), records);
      onWorn(number);
      expect(number).toMatchObject({ comparison: null });
      expect(crown(number)).toBeNull();
    }
    const cleared = at(addDays(real, 13), records);
    onWorn(cleared);
    expect(cleared).toMatchObject({ comparison: { baseline: { from: real, through: addDays(real, 6), value: 8000, days: 7 },
      current: { from: addDays(real, 7), value: 9000, days: 7 }, improvement: 1000, sinceFirstGame: false } });
    expect(crown(cleared)).toBe("a");
    expect(at(addDays(real, 2), records)).toMatchObject({ latest: { value: 15000 } }); // under four real days on the device
  });
  it.each(["apple-health-kit", "google-health", "health-connect", "samsung-health", "manual"])("prefers a worn device with readings this week over %s", other => {
    const records = [...steps(other, addDays(first, -60), 80, 15000), ...steps("garmin", addDays(first, 15), 4, 9000)];
    expect(at(addDays(first, 19), records)).toMatchObject({ latest: { value: 9000 }, comparison: null });
  });
  it("keeps the device worn this week over a spare with more old days", () => {
    const records = [...steps("garmin", addDays(first, -30), 20, 300), ...steps("garmin", addDays(first, 17), 2, 1500),
      ...steps("whoop", addDays(first, 10), 9, 9000), ...steps("apple-health-kit", addDays(first, -60), 80, 15000)];
    expect(at(addDays(first, 19), records)).toMatchObject({ latest: { value: 9000 }, comparison: null });
  });
  it("leaves a worn device that stopped this week behind, and merged-only and worn-only members alone", () => {
    const merged = steps("apple-health-kit", addDays(first, -60), 80, 15000);
    const stopped = [...merged, ...steps("garmin", addDays(first, -60), 72, 8000)];
    expect(at(addDays(first, 19), stopped)).toMatchObject({ latest: { value: 15000 }, comparison: { baseline: { value: 15000 } } });
    expect(at(addDays(first, 19), merged)).toMatchObject({ comparison: { baseline: { days: 60 }, current: { days: 7 } } });
    const two = [...steps("garmin", addDays(first, -60), 80, 8000), ...steps("oura", addDays(first, 15), 5, 9000)];
    expect(at(addDays(first, 19), two)).toMatchObject({ latest: { value: 8000 }, comparison: { baseline: { value: 8000 } } });
    const health = [...rows("restingHeartRate", "apple-health-kit", addDays(first, -60), 80, 55), ...rows("restingHeartRate", "garmin", addDays(first, 15), 4, 60)];
    expect(boardNumber("restingHeartRate", { state: "available", records: health }, { from: addDays(first, -70), through: addDays(first, 19) }, first))
      .toMatchObject({ latest: { value: 55 } });
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


describe("settled any-days board obligations", () => {
  it.each([false, true])("stops any-3-of-7 at settlement with rematch=%s", rematch => {
    const game = state("2030-01-01", 7, [0, 1, 2]);
    game.game.status = "settled";
    game.game.terms.versions[0].schedule = { count: 3 };
    const now = new Date("2030-01-07T12:00:00Z");
    const settledAt = new Date("2030-01-03T18:00:00Z");
    const next = state("2030-01-03", 7, [0, 1, 2, 3, 4]);
    expect(pairBoardStreak([{ state: game, now, settledAt }, ...(rematch ? [{ state: next, now }] : [])], "a")).toBe(rematch ? 7 : 3);
    game.game.status = "live";
    expect(pairBoardStreak([{ state: game, now, settledAt }], "a")).toBe(0);
  });
  it("preserves natural endings", () => {
    const game = state("2030-01-01", 7, [4, 5, 6]);
    game.game.status = "settled";
    game.game.terms.versions[0].schedule = { count: 3 };
    expect(pairBoardStreak([{ state: game, now: new Date("2030-01-20"), settledAt: new Date("2030-01-08T04:00:00Z") }], "a")).toBe(3);
  });
});
