import { describe, expect, it } from "vitest";

import {
  listReviewedBiomarkerFallbackRanges,
  resolveBiomarkerFallbackStatusRanges,
  resolveReviewedBiomarkerFallbackRanges,
} from "../src/lab-reference-ranges.ts";

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

const DISPLAY_CATALOG_KEYS = [
  "biomarker:absolute-basophils",
  "biomarker:absolute-eosinophils",
  "biomarker:absolute-lymphocytes",
  "biomarker:absolute-monocytes",
  "biomarker:absolute-neutrophils",
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
  "biomarker:mean-corpuscular-volume",
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
  "biomarker:white-blood-cell-count",
  "biomarker:zinc",
] as const;

describe("reviewed lab reference range runtime catalog", () => {
  it("covers 40 canonical identities through 43 exact-unit records", () => {
    const entries = listReviewedBiomarkerFallbackRanges();
    expect(entries.map((entry) => entry.entityKey).sort()).toEqual([
      ...PAGE_AUTHORED_STATUS_MIRRORS,
      ...DISPLAY_CATALOG_KEYS,
    ].sort());
    expect(entries).toHaveLength(40);
    expect(entries.reduce((count, entry) => count + entry.ranges.length, 0)).toBe(43);

    for (const entry of entries) {
      expect(new Set(entry.ranges.map(({ range }) => range.unit)).size).toBe(
        entry.ranges.length,
      );
      for (const reviewed of entry.ranges) {
        expect(reviewed.range.eligibleSpecimenKinds.length).toBeGreaterThan(0);
        expect(Boolean(reviewed.range.lowerBound || reviewed.range.upperBound)).toBe(true);
        expect(reviewed.range.source.organization.length).toBeGreaterThan(0);
        expect(reviewed.range.source.title.length).toBeGreaterThan(0);
        expect(reviewed.range.source.url ?? "").toMatch(/^https:\/\//u);
        expect([
          reviewed.statusMapping.above,
          reviewed.statusMapping.below,
          reviewed.statusMapping.within,
        ].every((value) => [
          "above_range",
          "below_range",
          "in_range",
          "reported",
        ].includes(value))).toBe(true);
      }
    }
  });

  it("keeps page-authored mirrors status-only while exposing the larger display catalog", () => {
    for (const entityKey of PAGE_AUTHORED_STATUS_MIRRORS) {
      expect(resolveReviewedBiomarkerFallbackRanges(entityKey)).toEqual([]);
      expect(resolveBiomarkerFallbackStatusRanges(entityKey)).toHaveLength(1);
    }

    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:free-t4")).toEqual([
      expect.objectContaining({
        eligibleSpecimenKinds: ["serum"],
        lowerBound: { inclusive: true, value: 0.9 },
        unit: "ng/dL",
        upperBound: { inclusive: true, value: 1.7 },
      }),
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
  });

  it("derives status only from ranges that are safe to classify", () => {
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:albumin")[0]?.statusMapping)
      .toEqual({ above: "above_range", below: "below_range", within: "in_range" });
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:apob")[0]?.statusMapping)
      .toEqual({ above: "reported", below: "reported", within: "reported" });
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:egfr")[0]?.statusMapping)
      .toEqual({ above: "above_range", below: "below_range", within: "in_range" });
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:ferritin")[0]?.statusMapping)
      .toEqual({ above: "reported", below: "reported", within: "reported" });
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:white-blood-cell-count")[0]?.statusMapping)
      .toEqual({ above: "above_range", below: "below_range", within: "in_range" });
  });

  it("resolves stable metric-key aliases without duplicating catalog entries", () => {
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:total-bilirubin"))
      .toEqual(resolveBiomarkerFallbackStatusRanges("biomarker:bilirubin"));
    expect(resolveBiomarkerFallbackStatusRanges("biomarker:vitamin-d"))
      .toEqual(resolveBiomarkerFallbackStatusRanges("biomarker:serum-25-hydroxyvitamin-d"));
  });
});
