import { describe, expect, it } from "vitest";
import { projectCompanionEnvironmentReport } from "@/src/lib/environment/companion-report";
import { environmentClient, environmentValues } from "./fixtures/companion-environment";

const input = { generatedAt: "2026-09-06T12:00:00.000Z", freshness: "fresh" as const, imperial: false };

describe("companion environment projection", () => {
  it("projects canonical facts, five categories and the same B grade as the web", () => {
    const report = projectCompanionEnvironmentReport({ ...input, client: environmentClient() });
    expect(report.categories.map((category) => category.id)).toEqual(["sleep", "air", "light", "recovery", "workspace"]);
    expect(report.grade).toMatchObject({ letter: "B", met: 13, graded: 16, eligible: 16, pct: 81 });
    expect(report.categories[0]?.rows.find((row) => row.indicatorId === "night_temp_c")?.value).toBe("24°C");
    expect(report.categories[0]?.rows.find((row) => row.indicatorId === "night_temp_c")?.target).toBe("18-22°C");
    const imperial = projectCompanionEnvironmentReport({ ...input, imperial: true, client: environmentClient() });
    expect(imperial.grade).toEqual(report.grade);
    expect(imperial.categories[0]?.rows.find((row) => row.indicatorId === "night_temp_c")?.value).toBe("75°F");
    expect(imperial.categories[0]?.rows.find((row) => row.indicatorId === "night_temp_c")?.target).toBe("64–72°F");
  });
  it("keeps unknown and skipped conditions ungraded", () => {
    const report = projectCompanionEnvironmentReport({ ...input, client: environmentClient({
      "sleep-environment": { night_noise: "declined", night_temp_c: 20 },
    }) });
    expect(report.grade.letter).toBeNull();
    expect(report.categories[0]?.skippedFacts.some((fact) => fact.indicatorId === "night_noise")).toBe(true);
    expect(report.categories[0]?.unknownFacts.some((fact) => fact.indicatorId === "darkness")).toBe(true);
    expect(projectCompanionEnvironmentReport({ ...input, client: environmentClient({}) }).grade.letter).toBeNull();
  });
  it("preserves red flags, staleness and source timestamp", () => {
    const report = projectCompanionEnvironmentReport({ ...input, freshness: "stale", client: environmentClient({
      ...environmentValues, "home-air": { damp_or_mold: "visible_mold", smoke_sources: "none" },
    }) });
    expect(report.grade.letter).toBe("F");
    expect(report.grade.redFlags).toBe(1);
    expect(report.freshness).toBe("stale");
    expect(report.generatedAt).toBe(input.generatedAt);
  });
});
