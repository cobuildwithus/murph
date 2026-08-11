import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  healthCommonsBiomarkerFallbackRangeSchema,
} from "@murphai/contracts";
import { beforeAll, describe, expect, it } from "vitest";

import { readHealthCommonsContent, type HealthCommonsSourcePage } from "../src/load.ts";
import {
  listReviewedBiomarkerFallbackRanges,
  resolveBiomarkerFallbackStatusRanges,
  resolveReviewedBiomarkerFallbackRanges,
} from "../src/biomarker-fallback-ranges.ts";

const PAGE_AUTHORED_STATUS_MIRRORS = [
  "biomarker:bilirubin",
  "biomarker:carbon-dioxide",
  "biomarker:chloride",
  "biomarker:ldh",
  "biomarker:phosphate",
  "biomarker:potassium",
  "biomarker:sodium",
  "biomarker:total-protein",
] as const;

const WHOLE_BLOOD_CBC_KEYS = [
  "biomarker:absolute-basophils",
  "biomarker:absolute-eosinophils",
  "biomarker:absolute-lymphocytes",
  "biomarker:absolute-monocytes",
  "biomarker:absolute-neutrophils",
  "biomarker:mean-corpuscular-volume",
  "biomarker:white-blood-cell-count",
] as const;

const EXPECTED_ENTITY_KEYS = [
  ...PAGE_AUTHORED_STATUS_MIRRORS,
  ...WHOLE_BLOOD_CBC_KEYS,
  "biomarker:albumin",
  "biomarker:anion-gap",
  "biomarker:apolipoprotein-b",
  "biomarker:egfr",
  "biomarker:egfr-ckd-epi",
  "biomarker:ferritin",
  "biomarker:free-t3",
  "biomarker:free-t4",
  "biomarker:hs-crp",
  "biomarker:iron-saturation",
  "biomarker:ldl-c",
  "biomarker:ldl-calculated",
  "biomarker:ldl-chol-calc-nih",
  "biomarker:lipoprotein-a",
  "biomarker:methylmalonic-acid",
  "biomarker:non-hdl-cholesterol",
  "biomarker:rheumatoid-factor",
  "biomarker:serum-25-hydroxyvitamin-d",
  "biomarker:thyroglobulin-antibodies",
  "biomarker:thyroid-peroxidase-antibodies",
  "biomarker:thyroid-stimulating-hormone",
  "biomarker:total-cholesterol",
  "biomarker:total-iron-binding-capacity",
  "biomarker:triglycerides",
  "biomarker:zinc",
] as const;

const contentRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../content",
);
let pagesByKey: ReadonlyMap<string, HealthCommonsSourcePage>;

beforeAll(async () => {
  const content = await readHealthCommonsContent(contentRoot);
  pagesByKey = new Map(content.pages.map((page) => [page.frontmatter.key, page]));
});

describe("reviewed biomarker fallback range catalog", () => {
  it("keeps the expanded runtime catalog sourced, bounded, and exact-unit-specific", () => {
    const entries = listReviewedBiomarkerFallbackRanges();
    expect(entries.map((entry) => entry.entityKey).sort()).toEqual(
      [...EXPECTED_ENTITY_KEYS].sort(),
    );
    expect(entries).toHaveLength(40);
    expect(entries.reduce((count, entry) => count + entry.ranges.length, 0)).toBe(43);

    for (const entry of entries) {
      expect(new Set(entry.ranges.map(({ range }) => range.unit)).size).toBe(
        entry.ranges.length,
      );

      for (const reviewed of entry.ranges) {
        const { range, statusMapping } = reviewed;
        // Page-authored Health Commons frontmatter still owns the legacy
        // serum/plasma schema. The shared runtime catalog additionally carries
        // generation-4 whole-blood CBC records, validated explicitly below.
        if (range.eligibleSpecimenKinds.every((kind) =>
          kind === "serum" || kind === "plasma"
        )) {
          expect(() => healthCommonsBiomarkerFallbackRangeSchema.parse(range)).not.toThrow();
        }
        expect(range.applicability).toMatch(
          /not the reporting laboratory's range/iu,
        );
        expect(range.applicability).toMatch(
          /source-laboratory flags and per-result ranges remain authoritative/iu,
        );
        expect(`${range.label} ${range.applicability}`).not.toMatch(
          /\b(?:optimal|wellness)\b/iu,
        );
        expect(`${range.label} ${range.applicability}`).not.toMatch(
          /\bdiagnos(?:e|ed|es|ing|is|tic)\b/iu,
        );
        expect(range.eligibleSpecimenKinds.length).toBeGreaterThan(0);
        expect(Boolean(range.lowerBound || range.upperBound)).toBe(true);
        expect(range.source.organization.length).toBeGreaterThan(0);
        expect(range.source.title.length).toBeGreaterThan(0);
        expect(range.source.year).toBeGreaterThanOrEqual(2020);
        expect(range.source.url ?? "").toMatch(/^https:\/\//u);
        expect([
          statusMapping.above,
          statusMapping.below,
          statusMapping.within,
        ].every((value) => [
          "above_range",
          "below_range",
          "in_range",
          "reported",
        ].includes(value))).toBe(true);
      }
    }
  });

  it("keeps status-only mirrors aligned with the eight page-authored comparators", () => {
    const entriesByKey = new Map(
      listReviewedBiomarkerFallbackRanges().map((entry) => [entry.entityKey, entry]),
    );

    for (const entityKey of PAGE_AUTHORED_STATUS_MIRRORS) {
      const authored = pagesByKey.get(entityKey)?.frontmatter.referenceGuidance
        ?.fallbackRanges?.[0];
      const mirrored = entriesByKey.get(entityKey)?.ranges[0];
      expect(authored, entityKey).toBeDefined();
      expect(mirrored, entityKey).toBeDefined();
      expect(mirrored?.displayFallback, entityKey).toBe(false);
      expect(mirrored?.range, entityKey).toMatchObject({
        eligibleSpecimenKinds: authored?.eligibleSpecimenKinds,
        label: authored?.label,
        lowerBound: authored?.lowerBound,
        source: {
          organization: authored?.source.organization,
          title: authored?.source.title,
          url: authored?.source.url,
          year: authored?.source.year,
        },
        unit: authored?.unit,
        upperBound: authored?.upperBound,
      });
      expect(resolveReviewedBiomarkerFallbackRanges(entityKey), entityKey).toEqual([]);
      expect(resolveBiomarkerFallbackStatusRanges(entityKey), entityKey).toHaveLength(1);
    }
  });

  it("projects display-only ranges without leaking source metadata into client props", () => {
    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:ldl-calculated")).toEqual([
      {
        applicability: expect.stringContaining(
          "Formula identity and triglyceride context remain part of the result.",
        ),
        eligibleSpecimenKinds: ["serum"],
        label: "Published adult calculated LDL-C comparator",
        unit: "mg/dL",
        upperBound: { inclusive: false, value: 100 },
      },
    ]);

    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:free-t3")).toEqual([
      expect.objectContaining({
        lowerBound: { inclusive: true, value: 2 },
        unit: "pg/mL",
        upperBound: { inclusive: true, value: 4.4 },
      }),
    ]);
    expect(resolveReviewedBiomarkerFallbackRanges(
      "biomarker:total-iron-binding-capacity",
    )).toEqual([
      expect.objectContaining({ unit: "mcg/dL" }),
      expect.objectContaining({ unit: "mcg/dL (calc)" }),
    ]);
    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:white-blood-cell-count"))
      .toEqual([
        expect.objectContaining({
          eligibleSpecimenKinds: ["whole_blood"],
          lowerBound: { inclusive: true, value: 3.4 },
          unit: "10^3/uL",
          upperBound: { inclusive: true, value: 9.6 },
        }),
      ]);
    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:poc-troponin-i")).toEqual([]);
    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:hba1c")).toEqual([]);
  });

  it("keeps decision and risk comparators contextual while classifying reference intervals", () => {
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:albumin")[0]?.statusMapping)
      .toEqual({ above: "above_range", below: "below_range", within: "in_range" });
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:apob")[0]?.statusMapping)
      .toEqual({ above: "reported", below: "reported", within: "reported" });
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:ferritin")[0]?.statusMapping)
      .toEqual({ above: "reported", below: "reported", within: "reported" });
  });

  it("keeps the whole-blood CBC extension source-locked and status-eligible", () => {
    for (const entityKey of WHOLE_BLOOD_CBC_KEYS) {
      const reviewed = listReviewedBiomarkerFallbackRanges()
        .find((entry) => entry.entityKey === entityKey)?.ranges[0];
      expect(reviewed, entityKey).toBeDefined();
      expect(reviewed?.range.eligibleSpecimenKinds, entityKey).toEqual(["whole_blood"]);
      expect(reviewed?.range.source, entityKey).toMatchObject({
        organization: "Mayo Clinic Laboratories",
        title: "Complete Blood Cell Count with Differential, Blood",
        url: "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
        year: 2026,
      });
      expect(reviewed?.statusMapping, entityKey).toEqual({
        above: "above_range",
        below: "below_range",
        within: "in_range",
      });
    }
  });
});
