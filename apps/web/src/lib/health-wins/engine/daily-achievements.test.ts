import { describe, expect, it } from "vitest";
import { dailyAchievements } from "./daily-achievements";
import { cleanDaily } from "./daily-clean";
import type { DailySample, Metric } from "./types";

const TODAY = "2032-04-28";
const SLEEP = "sleep_total_min";

function dateAt(offset: number): string {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function sample(metric: Metric, date: string, value: number, provider = "whoop"): DailySample {
  return { metric, date, value, provider };
}

function nights(values: number[], offset = 1 - values.length): DailySample[] {
  return values.map((value, i) => sample(SLEEP, dateAt(offset + i), value));
}

function cards(metric: Metric, rows: DailySample[], today = TODAY) {
  return dailyAchievements(metric, cleanDaily(rows, today), today).map(({ card }) => card);
}

describe("threshold_count", () => {
  it("requires ten observed nights and sixty percent reaching eight hours, within this month", () => {
    const values = [480, 489, 510, 530, 495, 492, 430, 460, 433, 447];
    expect(cards(SLEEP, nights(values))).toContainEqual(expect.objectContaining({
      kind: "threshold_count", title: { number: "6 of 10 nights", measure: "8+ hours" },
      subtitle: "in April so far",
    }));
    expect(cards(SLEEP, nights([478, ...values.slice(1)])).some(c => c.kind === "threshold_count")).toBe(false);
    const sparse = [...nights(values.slice(0, 9)), sample(SLEEP, "2032-03-31", 500)];
    expect(cards(SLEEP, sparse).some(c => c.kind === "threshold_count")).toBe(false);
  });

  it("omits partial nights from the count and the bars and cannot join a streak across one", () => {
    const values = [505, 489, 510, 79, 530, 495, 492, 430, 460, 433, 447];
    const result = cards(SLEEP, nights(values));
    const count = result.find(c => c.kind === "threshold_count");
    expect(count?.title.number).toBe("6 of 10 nights");
    expect(count?.chart.series).toHaveLength(10);
    expect(count?.chart.series.map(point => point.date)).not.toContain("2032-04-21");
    expect(result.some(c => c.kind === "streak")).toBe(false);
  });
});

describe("streak", () => {
  it("selects the latest tied longest run of at least five consecutive calendar days", () => {
    const five = [485, 493, 511, 508, 492];
    const rows = [...nights(five, -25), ...nights([...five, 449, ...five], -13)];
    const result = cards(SLEEP, rows).find(c => c.kind === "streak");
    expect(result?.title).toEqual({ number: "5 nights", measure: "8+ hours" });
    expect(result?.subtitle).toBe("in a row, Apr 21 to 25");
    expect(result?.chart.highlight).toEqual({ start: "2032-04-21", end: "2032-04-25" });
    expect(cards(SLEEP, nights(five.slice(1))).some(c => c.kind === "streak")).toBe(false);
  });

  it("uses only the last ninety days, and the longest run must end within sixty days", () => {
    const five = [485, 493, 511, 508, 492];
    const endedOnCutoff = nights(five, -64);
    expect(cards(SLEEP, endedOnCutoff).some(c => c.kind === "streak")).toBe(true);
    const older = nights([...five, 501], -66);
    expect(cards(SLEEP, [...older, ...nights(five)]).some(c => c.kind === "streak")).toBe(false);
    const crossingWindow = nights([...five, 488, 496], -93);
    const recent = cards(SLEEP, [...crossingWindow, ...nights(five)]).find(c => c.kind === "streak");
    expect(recent?.chart.highlight).toEqual({ start: "2032-04-24", end: "2032-04-28" });
  });

  it("names both months when a streak crosses New Year's Day", () => {
    const days = ["2031-12-29", "2031-12-30", "2031-12-31", "2032-01-01", "2032-01-02"];
    const result = cards(SLEEP, days.map(date => sample(SLEEP, date, 510)), "2032-01-03");
    expect(result.find(card => card.kind === "streak")?.subtitle).toBe("in a row, Dec 29, 2031 to Jan 2");
  });
});

describe("personal_record", () => {
  it("limits records to unambiguous metrics and takes the lowest RHR", () => {
    const cases: [Metric, number, number][] = [
      ["sleep_deep_min", 75, 88], ["rhr_bpm", 70, 66], ["hrv_ms", 43, 49],
      ["steps", 3500, 7200], ["distance_km", 3, 9],
    ];
    for (const [metric, previous, current] of cases) {
      const provider = metric === "distance_km" ? "apple" : "whoop";
      const rows = [sample(metric, dateAt(-76), previous, provider), sample(metric, TODAY, current, provider)];
      const record = cards(metric, rows).find(c => c.kind === "personal_record");
      expect(record?.chart.highlight, metric).toEqual({
        date: TODAY, label: "Apr 28", value: metric === "distance_km" ? current / 1.609344 : current,
      });
      if (metric === "distance_km") expect(record?.title.measure).toContain("on foot");
    }
    const excluded: [Metric, number, number][] = [
      [SLEEP, 420, 710], ["sleep_score", 78, 83], ["floors", 3, 9], ["vo2max", 43, 46],
    ];
    for (const [metric, a, b] of excluded) {
      const rows = [sample(metric, dateAt(-5), a, "apple"), sample(metric, TODAY, b, "apple")];
      expect(cards(metric, rows).some(c => c.kind === "personal_record"), metric).toBe(false);
    }
  });

  it("labels tied records and requires recent wins for steps", () => {
    const rows = [
      sample("steps", "2031-04-28", 28000), sample("steps", "2031-04-29", 7000),
      sample("steps", dateAt(-86), 6300),
      sample("steps", dateAt(-72), 12600), sample("steps", dateAt(-60), 12600),
    ];
    const fresh = cards("steps", rows).find(c => c.kind === "personal_record");
    expect(fresh?.chart.highlight).toEqual({ date: "2032-02-28", label: "Feb 28", value: 12600 });
    expect(fresh?.subtitle).toBe("on Feb 28, tied for most this year");
    const stale = [...rows.slice(0, -1), sample("steps", dateAt(-61), 12600), sample("steps", TODAY, 8500)];
    expect(cards("steps", stale)).toHaveLength(0);
    expect(cards("steps", [sample("steps", TODAY, 7200)])).toHaveLength(0);
  });

  it("keeps an older high-volume distance day as the record and reports the selected miles", () => {
    const asOf = "2034-09-19";
    const rows = [
      sample("distance_km", "2033-12-29", 40),
      ...[1, 2, 3, 4, 5].map(day => sample("distance_km", `2034-02-0${day}`, 3)),
      sample("distance_km", "2034-02-09", 19, "apple"),
      sample("distance_km", "2034-02-09", 30, "garmin"),
      sample("distance_km", asOf, 4),
    ];
    const record = cards("distance_km", rows, asOf).find(card => card.kind === "personal_record");
    expect(record).toMatchObject({
      title: { number: "12", measure: "miles on foot" },
      subtitle: "on Feb 9, most this year",
      source_note: "Recorded on Feb 9. Based on 7 tracked days.",
      chart: { unit: "miles", pills: ["Feb 9"], highlight: { date: "2034-02-09", label: "Feb 9", value: 19 / 1.609344 } },
    });
  });

  it("dates a sleep record and names the comparison window when the year changes", () => {
    const rows = [sample("sleep_deep_min", "2034-12-03", 76), sample("sleep_deep_min", "2034-12-19", 104)];
    const record = (asOf: string) => cards("sleep_deep_min", rows, asOf).find(card => card.kind === "personal_record");
    const december = record("2034-12-22");
    const january = record("2035-01-06");
    expect(december).toMatchObject({
      title: { number: "1h 44m", measure: "deep sleep" }, subtitle: "on Dec 19, most this year",
      chart: { highlight: { label: "Dec 19" }, pills: ["Dec 19"] },
    });
    expect(january).toMatchObject({
      subtitle: "on Dec 19, 2034, most in the past 12 months",
      source_note: "Recorded on Dec 19, 2034. Based on 2 tracked days.",
      chart: { highlight: { label: "Dec 19, 2034" }, pills: ["Dec 19, 2034"] },
    });
    expect(january?.id).toBe(december?.id);
  });

  it("computes the steps record from the selected daily provider", () => {
    const rows = [
      sample("steps", dateAt(-7), 5000), sample("steps", TODAY, 13111),
      sample("steps", TODAY, 22007, "apple"),
    ];
    const record = cards("steps", rows).find(c => c.kind === "personal_record");
    expect(record?.title).toEqual({ number: "13,111", measure: "steps" });
    expect(record?.chart.highlight).toEqual({ date: TODAY, label: "Apr 28", value: 13111 });
  });
});
