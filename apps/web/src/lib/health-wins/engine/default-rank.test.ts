import { describe, expect, it } from "vitest";
import { generateHealthWins, type DailySample, type HealthWinsInput, type LabDraw } from "./index";

const member = { today: "2032-06-14", age: 44, sex: "female", wearableProvider: "Garmin" } as const;

function percentiles(input: Partial<HealthWinsInput>) {
  return generateHealthWins({ member, ...input }).filter(card => card.kind === "percentile");
}

describe("the default health win ranker", () => {
  it("24. ranks a covered RHR month using only the selected device on each date", () => {
    const wearer = { ...member, wearableProvider: " WHOOP ", today: "2032-06-30" };
    const observations: DailySample[] = [...Array.from({ length: 13 }, (_, index) => index + 1), 28].map(day => ({
      metric: "rhr_bpm", date: `2032-06-${String(day).padStart(2, "0")}`, provider: " WHOOP ", value: 54.8,
    }));
    const daily = observations.flatMap(row => [
      { ...row, provider: "apple-health-kit", value: 60 },
      { ...row, provider: "google-health", value: 65 },
      { ...row, provider: "Garmin", value: 62 }, row,
    ]);
    const [card] = percentiles({ member: wearer, daily });
    expect(card).toMatchObject({
      filter: "Heart", title: { number: "Top 25%", measure: "RHR" }, subtitle: "for women in their 40s",
      source_note: expect.stringContaining("Mean of 14 recorded days this month through Jun 30"),
    });
    expect(card.chart.value).toBeCloseTo(54.8);
    expect(percentiles({ member: wearer, daily: [...daily].reverse() })).toEqual([card]);
    expect(percentiles({ member: wearer, daily: observations.slice(1) })).toEqual([]);
    // An incompatible method before the rolling fortnight still contributed to the monthly mean.
    expect(percentiles({ member: wearer, daily: [{ ...observations[0], provider: "Apple-Watch" }, ...observations.slice(1)] })).toEqual([]);
  });

  it("uses the shared RHR reference for the method used throughout the window", () => {
    const daily: DailySample[] = Array.from({ length: 14 }, (_, day) => ({
      metric: "rhr_bpm", provider: day % 2 ? "Oura" : "Garmin", value: 55,
      date: `2032-06-${String(day + 1).padStart(2, "0")}`,
    }));
    expect(percentiles({ daily })).toMatchObject([{ title: { number: "Top 26%" }, chart: { lowerIsBetter: true },
      source_note: "Mean of 14 recorded days in the 14 days through Jun 14. Oura sleeping heart rate norms" }]);

    const watch = { ...member, wearableProvider: "Apple Watch" };
    const watchDays = daily.map(day => ({ ...day, provider: "Apple Watch" }));
    expect(percentiles({ daily: watchDays, member: watch })).toMatchObject([{ title: { number: "Top 5%" },
      source_note: "Mean of 14 recorded days in the 14 days through Jun 14. Apple Heart and Movement Study" }]);
    expect(percentiles({ daily: watchDays })).toEqual([]);
    expect(percentiles({ daily: [daily[0], ...watchDays.slice(1)], member: watch })).toEqual([]);
    expect(percentiles({ daily: watchDays.map(day => ({ ...day, provider: "Apple Health" })), member: watch })).toEqual([]);
  });

  it.each([
    ["steps", 18000, "Mean of 14 recorded days in the 14 days through Jun 14. US adults, NHANES 2011-2014"],
    ["vo2max", 55, "Wearable estimate on Jun 14. FRIEND registry"],
  ] as const)("includes a short display citation for %s", (metric, value, source_note) => {
    const daily: DailySample[] = Array.from({ length: 14 }, (_, day) => ({
      metric, value, provider: "Garmin", date: `2032-06-${String(day + 1).padStart(2, "0")}`,
    }));
    expect(percentiles({ daily })).toMatchObject([{ source_note }]);
  });

  it("offers HDL at the 70% boundary and preserves integer precision inside the band", () => {
    const draw: LabDraw = { analyte: "hdl", unit: "mg/dL", date: member.today, value: 64 };
    expect(percentiles({ labs: [draw] })).toMatchObject([{ title: { number: "Top 30%" } }]);
    expect(percentiles({ labs: [{ ...draw, value: 63.99 }] })).toEqual([]);
    expect(percentiles({ labs: [{ ...draw, value: 65.6 }] })).toMatchObject([{
      title: { number: "Top 26%" }, chart: { group: "Women 40 to 49", lowerIsBetter: false },
      source_note: "Lab draw on Jun 14. US adults, NHANES 2021-2023",
    }]);
    expect(percentiles({ labs: [draw], member: { ...member, sex: null } })).toEqual([]);
    expect(percentiles({ labs: [draw], member: { ...member, age: 19 } })).toEqual([]);
    expect(percentiles({ labs: [{ ...draw, unit: "mmol/L" }] })).toEqual([]);
  });

  it.each<[LabDraw["analyte"], string, number, number]>([
    ["hs_crp", "mg/L", 0.27, 5],
    ["hdl", "mg/dL", 94, 5],
    ["hs_crp", "mg/L", 0.39, 8],
    ["hdl", "mg/dL", 82, 8],
  ])("20. uses the supported lab cutoffs and rounds up for %s (%s) at %s", (analyte, unit, value, topPercent) => {
    const [card] = percentiles({ labs: [{ analyte, unit, value, date: member.today }] });
    expect(card).toMatchObject({ title: { number: `Top ${topPercent}%` }, chart: { type: "percentile", topPercent } });
    expect(card.chart.cuts.map(cut => cut.percentile)).toEqual([5, 10, 25, 50, 75, 90, 95]);
  });

  it.each<[LabDraw["analyte"], string, number]>([
    ["ldl", "mg/dL", 89], ["triglycerides", "mg/dL", 64], ["insulin", "µIU/mL", 5.05],
  ])("20. accepts unknown fasting status for the %s fasting reference", (analyte, unit, value) => {
    const draw = { analyte, unit, value, date: member.today };
    for (const eligible of [draw, { ...draw, fasting: null }, { ...draw, fasting: true }]) {
      expect(percentiles({ labs: [eligible] })).toMatchObject([{
        title: { number: "Top 25%" }, chart: { lowerIsBetter: true },
      }]);
    }
    expect(percentiles({ labs: [draw] })[0].source_note).toContain("Fasting status unknown");
    expect(percentiles({ labs: [draw, { ...draw, fasting: null }] })[0].source_note).toContain("Fasting status unknown");
    expect(percentiles({ labs: [{ ...draw, fasting: true }] })[0].source_note).not.toContain("Fasting status unknown");
    expect(percentiles({ labs: [{ ...draw, fasting: false }] })).toEqual([]);
  });

  it("20. excludes glucose from the unknown-fasting comparisons", () => {
    expect(percentiles({ labs: [{ analyte: "glucose", unit: "mg/dL", value: 84, date: member.today }] })).toEqual([]);
  });
});
