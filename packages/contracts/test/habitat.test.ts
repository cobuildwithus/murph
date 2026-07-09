import { describe, expect, it } from "vitest";

import {
  computeHabitatCoverage,
  getHabitatAspectDefinition,
  getHabitatIndicatorDefinition,
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  validateHabitatIndicatorValue,
} from "../src/index.ts";
import { habitatFrontmatterSchema } from "../src/zod.ts";

const validFrontmatter = {
  schemaVersion: "murph.frontmatter.habitat.v1",
  docType: "habitat",
  habitatId: "hab_01JNV422Y2M5ZBV64ZP4N1DRB1",
  slug: "sleep-environment",
  title: "Bedroom & sleep",
  status: "active",
  domain: "environment",
  aspect: "sleep-environment",
  indicators: {
    night_temp_c: 19,
    temp_control: "ac",
    window_at_night: "open",
    co2_meter: HABITAT_DECLINED_VALUE,
  },
  indicatorRecordedAt: {
    night_temp_c: "2026-07-01",
  },
} as const;

describe("habitat catalog", () => {
  it("keeps aspect and indicator ids unique and domains consistent", () => {
    const aspectIds = new Set<string>();

    for (const aspect of HABITAT_CATALOG.aspects) {
      expect(aspectIds.has(aspect.id)).toBe(false);
      aspectIds.add(aspect.id);

      const indicatorIds = new Set<string>();
      for (const indicator of aspect.indicators) {
        expect(indicatorIds.has(indicator.id)).toBe(false);
        indicatorIds.add(indicator.id);
      }

      expect(aspect.indicators.length).toBeGreaterThan(0);
    }
  });

  it("validates indicator values against their declared type", () => {
    const darkness = getHabitatIndicatorDefinition("sleep-environment", "darkness");
    const nightTemp = getHabitatIndicatorDefinition("sleep-environment", "night_temp_c");

    expect(darkness).not.toBeNull();
    expect(nightTemp).not.toBeNull();
    expect(validateHabitatIndicatorValue(darkness!, "blackout")).toBeNull();
    expect(validateHabitatIndicatorValue(darkness!, "pitch-black")).toMatch(/Expected one of/);
    expect(validateHabitatIndicatorValue(nightTemp!, 19)).toBeNull();
    expect(validateHabitatIndicatorValue(nightTemp!, "warm")).toMatch(/Expected a number/);
    expect(validateHabitatIndicatorValue(nightTemp!, Number.POSITIVE_INFINITY)).toMatch(
      /Expected a number/,
    );
    expect(validateHabitatIndicatorValue(nightTemp!, HABITAT_DECLINED_VALUE)).toBeNull();
    expect(validateHabitatIndicatorValue(nightTemp!, null)).toBeNull();
  });
});

describe("habitat frontmatter schema", () => {
  it("accepts a valid aspect document", () => {
    const parsed = habitatFrontmatterSchema.safeParse(validFrontmatter);

    expect(parsed.success).toBe(true);
  });

  it("rejects unknown aspects, mismatched domains, and foreign indicators", () => {
    expect(
      habitatFrontmatterSchema.safeParse({ ...validFrontmatter, aspect: "spaceship" }).success,
    ).toBe(false);
    expect(
      habitatFrontmatterSchema.safeParse({ ...validFrontmatter, domain: "workspace" }).success,
    ).toBe(false);
    expect(
      habitatFrontmatterSchema.safeParse({ ...validFrontmatter, slug: "home-location" }).success,
    ).toBe(false);
    expect(
      habitatFrontmatterSchema.safeParse({
        ...validFrontmatter,
        indicators: { ...validFrontmatter.indicators, standing_desk: "fixed" },
      }).success,
    ).toBe(false);
    expect(
      habitatFrontmatterSchema.safeParse({
        ...validFrontmatter,
        indicators: { ...validFrontmatter.indicators, darkness: "pitch-black" },
      }).success,
    ).toBe(false);
    expect(
      habitatFrontmatterSchema.safeParse({
        ...validFrontmatter,
        indicatorRecordedAt: {
          ...validFrontmatter.indicatorRecordedAt,
          standing_desk: "2026-07-01",
        },
      }).success,
    ).toBe(false);
    expect(
      habitatFrontmatterSchema.safeParse({
        ...validFrontmatter,
        indicatorRecordedAt: {
          darkness: "2026-07-01",
        },
      }).success,
    ).toBe(false);
  });
});

describe("computeHabitatCoverage", () => {
  it("classifies indicators as known, declined, and unknown per aspect", () => {
    const coverage = computeHabitatCoverage([
      {
        aspect: "sleep-environment",
        indicators: {
          night_temp_c: 19,
          co2_meter: HABITAT_DECLINED_VALUE,
        },
      },
    ]);

    const environment = coverage.domains.find((domain) => domain.domain === "environment");
    const sleep = environment?.aspects.find((aspect) => aspect.aspectId === "sleep-environment");
    const aspectDefinition = getHabitatAspectDefinition("sleep-environment");

    expect(sleep).toBeDefined();
    expect(sleep!.counts.known).toBe(1);
    expect(sleep!.counts.declined).toBe(1);
    expect(sleep!.counts.total).toBe(aspectDefinition!.indicators.length);
    expect(sleep!.counts.unknown).toBe(aspectDefinition!.indicators.length - 2);
    expect(
      sleep!.topGaps.every(
        (indicator) => indicator.priority === "high" && indicator.status === "unknown",
      ),
    ).toBe(true);
    expect(sleep!.topGaps.map((indicator) => indicator.indicatorId)).not.toContain("night_temp_c");
    expect(sleep!.topGaps.map((indicator) => indicator.indicatorId)).not.toContain("co2_meter");
  });

  it("marks dated high-priority indicators stale after the configured window", () => {
    const coverage = computeHabitatCoverage(
      [
        {
          aspect: "sleep-environment",
          indicators: { night_temp_c: 19, darkness: "blackout" },
          indicatorRecordedAt: { night_temp_c: "2024-01-01", darkness: "2026-06-01" },
        },
      ],
      { now: "2026-07-08", staleAfterDays: 365 },
    );

    const sleep = coverage.domains
      .flatMap((domain) => domain.aspects)
      .find((aspect) => aspect.aspectId === "sleep-environment");
    const byId = new Map(
      sleep!.indicators.map((indicator) => [indicator.indicatorId, indicator]),
    );

    expect(byId.get("night_temp_c")!.status).toBe("stale");
    expect(byId.get("darkness")!.status).toBe("known");
  });

  it("covers the whole catalog with zero records", () => {
    const coverage = computeHabitatCoverage([]);
    const catalogIndicatorCount = HABITAT_CATALOG.aspects.reduce(
      (total, aspect) => total + aspect.indicators.length,
      0,
    );

    expect(coverage.counts.total).toBe(catalogIndicatorCount);
    expect(coverage.counts.unknown).toBe(catalogIndicatorCount);
    expect(coverage.domains.map((domain) => domain.domain)).toEqual([
      "environment",
      "workspace",
      "exercise",
    ]);
  });
});
