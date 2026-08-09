import {
  healthCommonsBiomarkerFallbackRangeSchema,
} from "@murphai/contracts";
import { describe, expect, it } from "vitest";

import {
  listReviewedBiomarkerFallbackRanges,
  resolveReviewedBiomarkerFallbackRanges,
} from "../src/biomarker-fallback-ranges.ts";

const EXPECTED_ENTITY_KEYS = [
  "biomarker:albumin",
  "biomarker:anion-gap",
  "biomarker:apolipoprotein-b",
  "biomarker:egfr",
  "biomarker:egfr-ckd-epi",
  "biomarker:ferritin",
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
  "biomarker:total-cholesterol",
  "biomarker:total-iron-binding-capacity",
  "biomarker:triglycerides",
  "biomarker:zinc",
] as const;

describe("reviewed biomarker fallback range catalog", () => {
  it("keeps the expanded catalog sourced, bounded, and exact-unit-specific", () => {
    const entries = listReviewedBiomarkerFallbackRanges();
    expect(entries.map((entry) => entry.entityKey).sort()).toEqual(
      [...EXPECTED_ENTITY_KEYS].sort(),
    );
    expect(entries).toHaveLength(22);
    expect(entries.reduce((count, entry) => count + entry.ranges.length, 0)).toBe(25);

    for (const entry of entries) {
      expect(new Set(entry.ranges.map((range) => range.unit)).size).toBe(
        entry.ranges.length,
      );

      for (const range of entry.ranges) {
        expect(() => healthCommonsBiomarkerFallbackRangeSchema.parse(range)).not.toThrow();
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
        expect(
          range.eligibleSpecimenKinds.every((kind) =>
            kind === "serum" || kind === "plasma"
          ),
        ).toBe(true);
        expect(Boolean(range.lowerBound || range.upperBound)).toBe(true);
        expect(range.source.organization.length).toBeGreaterThan(0);
        expect(range.source.title.length).toBeGreaterThan(0);
        expect(range.source.year).toBeGreaterThanOrEqual(2020);
        expect(range.source.url ?? "").toMatch(/^https:\/\//u);
      }
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

    expect(resolveReviewedBiomarkerFallbackRanges(
      "biomarker:total-iron-binding-capacity",
    )).toEqual([
      expect.objectContaining({ unit: "mcg/dL" }),
      expect.objectContaining({ unit: "mcg/dL (calc)" }),
    ]);
    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:poc-troponin-i")).toEqual([]);
    expect(resolveReviewedBiomarkerFallbackRanges("biomarker:hba1c")).toEqual([]);
  });
});
