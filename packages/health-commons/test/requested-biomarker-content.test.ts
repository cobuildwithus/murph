import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_BIOMARKER_GUIDANCE_CLASSIFICATIONS,
  healthCommonsBiomarkerGuidanceNumericValueSchema,
} from "@murphai/contracts";
import {
  resolveLabResultMetricDefinition,
  resolveMetricDefinition,
} from "@murphai/health-metrics";
import {
  HEALTH_COMMONS_BIOMARKER_ENTITY_MAPPINGS,
  resolveHealthCommonsBiomarkerEntityKey,
} from "../src/biomarker-entity-mappings.ts";
import { readHealthCommonsContent, type HealthCommonsSourcePage } from "../src/load.ts";

type RequestedLabMarker = readonly [
  label: string,
  metricKey: string,
  entityKey: string,
];

const REQUESTED_LAB_MARKERS = [
  // blood-sugar
  ["C-peptide", "c-peptide", "biomarker:c-peptide"],
  ["Glucose", "glucose", "biomarker:blood-glucose"],
  ["HbA1c", "hba1c", "biomarker:hba1c"],
  ["Insulin", "insulin", "biomarker:insulin"],
  // heart-and-lipids
  ["Homocysteine", "homocysteine", "biomarker:homocysteine"],
  ["LDL large particles", "ldl-large-particles", "biomarker:ldl-large-particles"],
  ["LDL medium particles", "ldl-medium-particles", "biomarker:ldl-medium-particles"],
  ["LDL particle number", "ldl-particle-number", "biomarker:ldl-particle-number"],
  ["LDL peak size", "ldl-peak-size", "biomarker:ldl-peak-size"],
  ["LDL small particles", "ldl-small-particles", "biomarker:ldl-small-particles"],
  ["LDL-C", "ldl-c", "biomarker:ldl-c"],
  ["Total cholesterol", "total-cholesterol", "biomarker:total-cholesterol"],
  ["ApoB", "apob", "biomarker:apolipoprotein-b"],
  ["Cholesterol/HDL ratio", "cholesterol-hdl-ratio", "biomarker:cholesterol-hdl-ratio"],
  ["HDL-C", "hdl-c", "biomarker:hdl-c"],
  ["LDL pattern", "ldl-pattern", "biomarker:ldl-pattern"],
  ["Lipoprotein(a)", "lipoprotein-a", "biomarker:lipoprotein-a"],
  ["Non-HDL cholesterol", "non-hdl-cholesterol", "biomarker:non-hdl-cholesterol"],
  ["Triglycerides", "triglycerides", "biomarker:triglycerides"],
  ["Calculated VLDL cholesterol", "vldl-cholesterol-calculated", "biomarker:vldl-cholesterol-calculated"],
  ["LDL Calculated", "ldl-calculated", "biomarker:ldl-calculated"],
  ["LDL CHOL CALC (NIH)", "ldl-chol-calc-nih", "biomarker:ldl-chol-calc-nih"],
  ["POC Troponin I", "poc-troponin-i", "biomarker:poc-troponin-i"],
  // kidneys
  ["Creatinine", "creatinine", "biomarker:serum-creatinine"],
  ["eGFR (CKD-EPI)", "egfr-ckd-epi", "biomarker:egfr-ckd-epi"],
  ["Blood urea nitrogen", "blood-urea-nitrogen", "biomarker:blood-urea-nitrogen"],
  ["eGFR", "egfr", "biomarker:egfr"],
  ["Uric Acid", "uric-acid", "biomarker:serum-uric-acid"],
  ["Urine protein", "urine-protein", "biomarker:urine-protein"],
  ["BUN/Creatinine Ratio", "bun-creatinine-ratio", "biomarker:bun-creatinine-ratio"],
  ["GFR MDRD Af Amer", "gfr-mdrd-af-amer", "biomarker:gfr-mdrd-af-amer"],
  ["GFR MDRD Non Af Amer", "gfr-mdrd-non-af-amer", "biomarker:gfr-mdrd-non-af-amer"],
  ["Urine albumin random without creatinine", "urine-albumin-random-without-creatinine", "biomarker:urine-albumin-random-without-creatinine"],
  // liver
  ["Albumin", "albumin", "biomarker:albumin"],
  ["Albumin/Globulin Ratio", "albumin-globulin-ratio", "biomarker:albumin-globulin-ratio"],
  ["Alkaline phosphatase", "alkaline-phosphatase", "biomarker:alkaline-phosphatase"],
  ["ALT", "alt", "biomarker:alanine-aminotransferase"],
  ["AST", "ast", "biomarker:aspartate-aminotransferase"],
  ["FIB-4", "fib4", "biomarker:fib4"],
  ["GGT", "ggt", "biomarker:ggt"],
  ["Globulin", "total-globulin", "biomarker:total-globulin"],
  ["Total bilirubin", "total-bilirubin", "biomarker:bilirubin"],
  ["Total Protein", "total-protein", "biomarker:total-protein"],
  // thyroid
  ["Free T3", "free-t3", "biomarker:free-t3"],
  ["Free T4", "free-t4", "biomarker:free-t4"],
  ["Thyroglobulin Antibodies", "thyroglobulin-antibodies", "biomarker:thyroglobulin-antibodies"],
  ["Thyroid Peroxidase Antibodies", "thyroid-peroxidase-antibodies", "biomarker:thyroid-peroxidase-antibodies"],
  ["Thyroid-stimulating hormone", "thyroid-stimulating-hormone", "biomarker:thyroid-stimulating-hormone"],
  // blood
  ["Neutrophils, absolute", "absolute-neutrophils", "biomarker:absolute-neutrophils"],
  ["White blood cells", "white-blood-cell-count", "biomarker:white-blood-cell-count"],
  ["Basophils", "basophil-percentage", "biomarker:basophil-percentage"],
  ["Basophils, absolute", "absolute-basophils", "biomarker:absolute-basophils"],
  ["Eosinophils", "eosinophil-percentage", "biomarker:eosinophil-percentage"],
  ["Eosinophils, absolute", "absolute-eosinophils", "biomarker:absolute-eosinophils"],
  ["Hematocrit", "hematocrit", "biomarker:hematocrit"],
  ["Hemoglobin", "hemoglobin", "biomarker:hemoglobin"],
  ["Lymphocytes", "lymphocyte-percentage", "biomarker:lymphocyte-percentage"],
  ["Lymphocytes, absolute", "absolute-lymphocytes", "biomarker:absolute-lymphocytes"],
  ["Mean corpuscular hemoglobin", "mean-corpuscular-hemoglobin", "biomarker:mean-corpuscular-hemoglobin"],
  ["Mean corpuscular hemoglobin concentration", "mean-corpuscular-hemoglobin-concentration", "biomarker:mean-corpuscular-hemoglobin-concentration"],
  ["Mean corpuscular volume", "mean-corpuscular-volume", "biomarker:mean-corpuscular-volume"],
  ["Mean Platelet Volume", "mean-platelet-volume", "biomarker:mean-platelet-volume"],
  ["Monocytes", "monocyte-percentage", "biomarker:monocyte-percentage"],
  ["Monocytes, absolute", "absolute-monocytes", "biomarker:absolute-monocytes"],
  ["Neutrophils", "neutrophil-percentage", "biomarker:neutrophil-percentage"],
  ["Platelets", "platelet-count", "biomarker:platelet-count"],
  ["Red blood cells", "red-blood-cell-count", "biomarker:red-blood-cell-count"],
  ["Red cell distribution width", "red-cell-distribution-width", "biomarker:red-cell-distribution-width"],
  ["Immature granulocytes", "immature-granulocyte-percentage", "biomarker:immature-granulocyte-percentage"],
  ["Immature granulocytes, absolute", "absolute-immature-granulocytes", "biomarker:absolute-immature-granulocytes"],
  ["MPV", "mean-platelet-volume", "biomarker:mean-platelet-volume"],
  // hormones
  ["Free testosterone", "free-testosterone", "biomarker:free-testosterone"],
  ["Cortisol", "cortisol", "biomarker:cortisol"],
  ["DHEA sulfate", "dhea-sulfate", "biomarker:dhea-sulfate"],
  ["Sex Hormone Binding Globulin", "sex-hormone-binding-globulin", "biomarker:sex-hormone-binding-globulin"],
  ["Total testosterone", "total-testosterone", "biomarker:total-testosterone"],
  ["Estradiol", "estradiol", "biomarker:estradiol"],
  ["Follicle Stimulating Hormone", "follicle-stimulating-hormone", "biomarker:follicle-stimulating-hormone"],
  ["Luteinizing Hormone", "luteinizing-hormone", "biomarker:luteinizing-hormone"],
  ["Prolactin", "prolactin", "biomarker:prolactin"],
  // nutrients-and-fatty-acids
  ["Omega-3 Total / OmegaCheck", "omega-3-total-omegacheck", "biomarker:omega-3-total-omegacheck"],
  ["Arachidonic Acid", "arachidonic-acid", "biomarker:arachidonic-acid"],
  ["Arachidonic Acid/EPA Ratio", "arachidonic-acid-epa-ratio", "biomarker:arachidonic-acid-epa-ratio"],
  ["DHA", "dha", "biomarker:dha"],
  ["DPA", "dpa", "biomarker:dpa"],
  ["EPA", "epa", "biomarker:epa"],
  ["Ferritin", "ferritin", "biomarker:ferritin"],
  ["Iron", "iron", "biomarker:iron"],
  ["Iron saturation", "iron-saturation", "biomarker:iron-saturation"],
  ["Linoleic Acid", "linoleic-acid", "biomarker:linoleic-acid"],
  ["Magnesium RBC", "magnesium-rbc", "biomarker:magnesium-rbc"],
  ["Methylmalonic Acid", "methylmalonic-acid", "biomarker:methylmalonic-acid"],
  ["Omega 6/3 Ratio", "omega-6-3-ratio", "biomarker:omega-6-3-ratio"],
  ["Total Iron Binding Capacity", "total-iron-binding-capacity", "biomarker:total-iron-binding-capacity"],
  ["Vitamin D", "vitamin-d", "biomarker:serum-25-hydroxyvitamin-d"],
  ["Zinc", "zinc", "biomarker:zinc"],
  ["Omega-6 total", "omega-6-total", "biomarker:omega-6-total"],
  ["OmegaCheck total", "omegacheck-total", "biomarker:omegacheck-total"],
  // inflammation-and-immune
  ["ANA screen", "ana-screen", "biomarker:ana-screen"],
  ["hs-CRP", "hs-crp", "biomarker:hs-crp"],
  ["Rheumatoid Factor", "rheumatoid-factor", "biomarker:rheumatoid-factor"],
  // electrolytes
  ["Adjusted Calcium", "adjusted-calcium", "biomarker:adjusted-calcium"],
  ["Calcium", "calcium", "biomarker:calcium"],
  ["Carbon Dioxide", "carbon-dioxide", "biomarker:carbon-dioxide"],
  ["Chloride", "chloride", "biomarker:chloride"],
  ["Phosphate", "phosphate", "biomarker:phosphate"],
  ["Potassium", "potassium", "biomarker:potassium"],
  ["Sodium", "sodium", "biomarker:sodium"],
  ["Anion Gap", "anion-gap", "biomarker:anion-gap"],
  ["CO2", "carbon-dioxide", "biomarker:carbon-dioxide"],
  // muscle-and-tissue
  ["Creatine Kinase", "creatine-kinase", "biomarker:creatine-kinase"],
  ["LDH", "ldh", "biomarker:ldh"],
  // environmental-exposure
  ["Lead", "lead", "biomarker:lead"],
  ["Mercury", "mercury", "biomarker:mercury"],
  // prostate-health
  ["PSA free", "psa-free", "biomarker:psa-free"],
  ["PSA percent free", "psa-percent-free", "biomarker:psa-percent-free"],
  ["PSA total", "psa-total", "biomarker:psa-total"],
] as const satisfies readonly RequestedLabMarker[];

const REQUESTED_DEVICE_MARKERS = [
  ["Deep sleep (minutes)", "deep-sleep-minutes", "biomarker:deep-sleep-minutes"],
  ["HRV / RMSSD (ms)", "hrv-rmssd", "biomarker:hrv-rmssd"],
  ["REM sleep (minutes)", "rem-sleep-minutes", "biomarker:rem-sleep-minutes"],
  ["Resting heart rate / RHR (bpm)", "resting-heart-rate", "biomarker:resting-heart-rate"],
  ["Blood oxygen / SpO₂ (%)", "spo2", "biomarker:blood-oxygen-spo2"],
] as const;

const EXPECTED_GUIDANCE_CLASSIFICATION_COUNTS = {
  calculated_or_method_specific: 17,
  conditional_numeric: 11,
  generally_applicable_numeric: 1,
  no_universal_range: 36,
  qualitative: 3,
  source_range_only: 52,
} as const;

const EXPECTED_FALLBACK_RANGES = {
  "biomarker:bilirubin": {
    lowerBound: 0,
    title: "Bilirubin, Total, Serum",
    unit: "mg/dL",
    upperBound: 1.2,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/81785",
  },
  "biomarker:carbon-dioxide": {
    lowerBound: 22,
    title: "Bicarbonate, Serum",
    unit: "mmol/L",
    upperBound: 29,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/876",
  },
  "biomarker:chloride": {
    lowerBound: 98,
    title: "Chloride, Serum",
    unit: "mmol/L",
    upperBound: 107,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/8460",
  },
  "biomarker:ldh": {
    lowerBound: 122,
    title: "Lactate Dehydrogenase (LDH), Serum",
    unit: "U/L",
    upperBound: 222,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/8344",
  },
  "biomarker:phosphate": {
    lowerBound: 2.5,
    title: "Phosphorus (Inorganic), Serum",
    unit: "mg/dL",
    upperBound: 4.5,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/8408",
  },
  "biomarker:potassium": {
    lowerBound: 3.6,
    title: "Potassium, Serum",
    unit: "mmol/L",
    upperBound: 5.2,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/602352",
  },
  "biomarker:sodium": {
    lowerBound: 135,
    title: "Sodium, Serum",
    unit: "mmol/L",
    upperBound: 145,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/602353",
  },
  "biomarker:total-protein": {
    lowerBound: 6.3,
    title: "Protein, Total, Serum",
    unit: "g/dL",
    upperBound: 7.9,
    url: "https://www.mayocliniclabs.com/test-catalog/Overview/8520",
  },
} as const;

const REPRESENTATIVE_CONTEXT_DEPENDENT_FALLBACK_OMISSIONS = [
  "biomarker:blood-glucose", // fasting state and test context
  "biomarker:hba1c", // diagnostic decision limits are not reference intervals
  "biomarker:vldl-cholesterol-calculated", // calculated output and method
  "biomarker:ldl-calculated", // calculation method and risk category
  "biomarker:ldl-chol-calc-nih", // named calculation method and risk category
  "biomarker:poc-troponin-i", // assay generation and 99th-percentile URL
  "biomarker:serum-creatinine", // age and sex
  "biomarker:bun-creatinine-ratio", // calculated output, age, and sex
  "biomarker:gfr-mdrd-af-amer", // historical race-based calculation
  "biomarker:gfr-mdrd-non-af-amer", // historical calculation method
  "biomarker:urine-albumin-random-without-creatinine", // urine concentration and hydration
  "biomarker:calcium", // adult interval changes with age and sex
  "biomarker:alkaline-phosphatase", // age and sex
  "biomarker:albumin", // assay method
  "biomarker:thyroid-stimulating-hormone", // pregnancy and clinical setting
  "biomarker:free-t4", // assay method
  "biomarker:hemoglobin", // age, sex, and pregnancy
  "biomarker:immature-granulocyte-percentage", // analyzer and local interval
  "biomarker:absolute-immature-granulocytes", // analyzer and local interval
  "biomarker:estradiol", // sex, reproductive stage, and assay
  "biomarker:follicle-stimulating-hormone", // sex and reproductive stage
  "biomarker:luteinizing-hormone", // sex and reproductive stage
  "biomarker:prolactin", // sex, pregnancy, and assay
  "biomarker:omega-6-total", // proprietary panel method
  "biomarker:omegacheck-total", // proprietary panel method
  "biomarker:anion-gap", // calculation formula and local method
  "biomarker:triglycerides", // fasting state and risk category
  "biomarker:ldl-c", // treatment target and risk category
  "biomarker:mercury", // specimen
  "biomarker:psa-total", // age and risk context
] as const;

const DECISION_NUMERIC_VALUES_THAT_MUST_NOT_BECOME_FALLBACKS = [
  "biomarker:blood-glucose",
  "biomarker:hba1c",
  "biomarker:ldl-c",
  "biomarker:ferritin",
  "biomarker:lead",
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

describe("requested biomarker Health Commons coverage", () => {
  it("resolves every requested lab identity to the intended authored Commons entity", () => {
    expect(REQUESTED_LAB_MARKERS).toHaveLength(117);

    for (const [label, metricKey, entityKey] of REQUESTED_LAB_MARKERS) {
      const definition = resolveLabResultMetricDefinition(label);
      if (!definition?.biomarkerKey) {
        throw new Error(`Unresolved requested lab marker: ${label}`);
      }

      expect(definition.key).toBe(metricKey);
      expect(resolveHealthCommonsBiomarkerEntityKey(definition.biomarkerKey)).toBe(entityKey);
      expect(pagesByKey.has(entityKey)).toBe(true);
    }

    expect(new Set(REQUESTED_LAB_MARKERS.map(([, metricKey]) => metricKey)).size).toBe(115);
    expect(new Set(REQUESTED_LAB_MARKERS.map(([, , entityKey]) => entityKey)).size).toBe(115);
  });

  it("keeps genuine aliases together and method- or specimen-specific identities apart", () => {
    expect(resolveLabResultMetricDefinition("MPV")?.key).toBe(
      resolveLabResultMetricDefinition("Mean Platelet Volume")?.key,
    );
    expect(resolveLabResultMetricDefinition("CO2")?.key).toBe(
      resolveLabResultMetricDefinition("Carbon Dioxide")?.key,
    );

    expect(resolveLabResultMetricDefinition("LDL Calculated")?.key).not.toBe(
      resolveLabResultMetricDefinition("LDL CHOL CALC (NIH)")?.key,
    );
    expect(resolveLabResultMetricDefinition("eGFR")?.key).not.toBe(
      resolveLabResultMetricDefinition("eGFR (CKD-EPI)")?.key,
    );
    expect(resolveLabResultMetricDefinition("GFR MDRD Af Amer")?.key).not.toBe(
      resolveLabResultMetricDefinition("GFR MDRD Non Af Amer")?.key,
    );
    expect(resolveLabResultMetricDefinition("Omega-3 Total / OmegaCheck")?.key).not.toBe(
      resolveLabResultMetricDefinition("OmegaCheck total")?.key,
    );
    expect(resolveLabResultMetricDefinition("Neutrophils")?.key).not.toBe(
      resolveLabResultMetricDefinition("Neutrophils, absolute")?.key,
    );
    expect(resolveLabResultMetricDefinition("blood mercury")).toBeNull();
    expect(resolveLabResultMetricDefinition("urine mercury")).toBeNull();

    const mercuryAliases = pagesByKey.get("biomarker:mercury")?.frontmatter.aliases ?? [];
    expect(mercuryAliases).not.toContain("blood-mercury");
    expect(mercuryAliases).not.toContain("urine-mercury");
  });

  it("backs all requested device metrics with authored Commons entities", () => {
    for (const [label, metricKey, entityKey] of REQUESTED_DEVICE_MARKERS) {
      const definition = resolveMetricDefinition(metricKey);
      if (!definition?.biomarkerKey) {
        throw new Error(`Unresolved requested device marker: ${label}`);
      }

      expect(resolveHealthCommonsBiomarkerEntityKey(definition.biomarkerKey)).toBe(entityKey);
      expect(pagesByKey.has(entityKey)).toBe(true);
    }
  });

  it("uses only explicit mappings whose authored targets exist", () => {
    expect(Object.keys(HEALTH_COMMONS_BIOMARKER_ENTITY_MAPPINGS)).toHaveLength(6);

    for (const [sourceKey, targetKey] of Object.entries(
      HEALTH_COMMONS_BIOMARKER_ENTITY_MAPPINGS,
    )) {
      expect(sourceKey).not.toBe(targetKey);
      expect(resolveHealthCommonsBiomarkerEntityKey(sourceKey)).toBe(targetKey);
      expect(pagesByKey.has(targetKey)).toBe(true);
    }
  });

  it("requires a reviewed one-sentence summary and structured guidance for every requested entity", () => {
    const requestedEntityKeys = new Set([
      ...REQUESTED_LAB_MARKERS.map(([, , entityKey]) => entityKey),
      ...REQUESTED_DEVICE_MARKERS.map(([, , entityKey]) => entityKey),
    ]);
    expect(requestedEntityKeys.size).toBe(120);

    const classificationCounts = new Map<string, number>();

    for (const entityKey of requestedEntityKeys) {
      const page = pagesByKey.get(entityKey);
      if (!page) {
        throw new Error(`Missing authored Commons page: ${entityKey}`);
      }

      const summary = page.frontmatter.summary?.trim() ?? "";
      expect(summary.split(/\s+/u).length).toBeGreaterThanOrEqual(10);
      expect(summary).toMatch(/^[^\r\n]+[.!?]$/u);
      expect(summary.match(/[.!?](?=\s|$)/gu) ?? []).toHaveLength(1);
      expect(summary).not.toMatch(/\b(?:todo|tbd|placeholder|coming soon|stub)\b/iu);

      const guidance = page.frontmatter.referenceGuidance;
      if (!guidance) {
        throw new Error(`Missing reviewed reference guidance: ${entityKey}`);
      }

      expect(guidance.reviewStatus).toBe("reviewed");
      expect(guidance.use).toBe("context_only");
      expect(guidance.items.length).toBeGreaterThan(0);
      classificationCounts.set(
        guidance.classification,
        (classificationCounts.get(guidance.classification) ?? 0) + 1,
      );

      for (const item of guidance.items) {
        expect(item.guidance.split(/\s+/u).length).toBeGreaterThanOrEqual(8);
        expect(item.applicability.split(/\s+/u).length).toBeGreaterThanOrEqual(8);
        expect(item.source.title.length).toBeGreaterThan(0);
        expect(item.source.organization.length).toBeGreaterThan(0);
        expect(item.source.year).toBeGreaterThanOrEqual(1900);
        expect(Boolean(item.source.url || item.source.doi || item.source.pmid)).toBe(true);

        for (const numericValue of item.numericValues ?? []) {
          expect(Boolean(numericValue.lowerBound || numericValue.upperBound)).toBe(true);
          if (numericValue.lowerBound && numericValue.upperBound) {
            expect(numericValue.lowerBound.value).toBeLessThanOrEqual(
              numericValue.upperBound.value,
            );
            expect(numericValue.lowerBound.value).not.toBe(numericValue.upperBound.value);
          }
        }
      }

      if (guidance.classification === "qualitative") {
        expect(guidance.items.every((item) => !item.numericValues)).toBe(true);
      }
    }

    expect(Object.fromEntries([...classificationCounts].sort())).toEqual(
      EXPECTED_GUIDANCE_CLASSIFICATION_COUNTS,
    );
    expect([...classificationCounts.keys()].sort()).toEqual(
      [...HEALTH_COMMONS_BIOMARKER_GUIDANCE_CLASSIFICATIONS].sort(),
    );
  });

  it("keeps authored fallback ranges reviewed, sourced, bounded, and unit-specific", () => {
    const requestedLabEntityKeys = new Set(
      REQUESTED_LAB_MARKERS.map(([, , entityKey]) => entityKey),
    );
    const actualFallbackEntityKeys: string[] = [];

    for (const entityKey of requestedLabEntityKeys) {
      const page = pagesByKey.get(entityKey);
      if (!page) {
        throw new Error(`Missing authored Commons page: ${entityKey}`);
      }

      const fallbackRanges = page.frontmatter.referenceGuidance?.fallbackRanges;
      if (!fallbackRanges) {
        continue;
      }

      actualFallbackEntityKeys.push(entityKey);
      expect(new Set(fallbackRanges.map((range) => range.unit)).size).toBe(
        fallbackRanges.length,
      );

      for (const range of fallbackRanges) {
        expect(range.eligibleSpecimenKinds).toEqual(["serum"]);
        expect(range.label.trim().length).toBeGreaterThan(0);
        expect(range.unit.trim()).toBe(range.unit);
        expect(range.unit.length).toBeGreaterThan(0);
        expect(range.applicability.split(/\s+/u).length).toBeGreaterThanOrEqual(8);
        expect(range.applicability).toMatch(
          /source-laboratory flags and per-result ranges remain authoritative/iu,
        );
        expect(`${range.label} ${range.applicability}`).not.toMatch(
          /\b(?:optimal|wellness)\b/iu,
        );
        expect(`${range.label} ${range.applicability}`).not.toMatch(
          /\bdiagnos(?:e|ed|es|ing|is|tic)\b/iu,
        );

        expect(range.source.title.length).toBeGreaterThan(0);
        expect(range.source.organization.length).toBeGreaterThan(0);
        expect(range.source.year).toBeGreaterThanOrEqual(1900);
        expect(Boolean(range.source.url || range.source.doi || range.source.pmid)).toBe(true);

        expect(Boolean(range.lowerBound || range.upperBound)).toBe(true);
        if (range.lowerBound) {
          expect(Number.isFinite(range.lowerBound.value)).toBe(true);
          expect(typeof range.lowerBound.inclusive).toBe("boolean");
        }
        if (range.upperBound) {
          expect(Number.isFinite(range.upperBound.value)).toBe(true);
          expect(typeof range.upperBound.inclusive).toBe("boolean");
        }
        if (range.lowerBound && range.upperBound) {
          expect(range.lowerBound.value).toBeLessThan(range.upperBound.value);
        }
      }
    }

    expect(actualFallbackEntityKeys.length).toBeGreaterThanOrEqual(8);
    expect(actualFallbackEntityKeys.sort()).toEqual(
      Object.keys(EXPECTED_FALLBACK_RANGES).sort(),
    );

    for (const [entityKey, expected] of Object.entries(EXPECTED_FALLBACK_RANGES)) {
      const fallbackRanges = pagesByKey.get(entityKey)?.frontmatter.referenceGuidance
        ?.fallbackRanges;
      expect(fallbackRanges).toHaveLength(1);

      const range = fallbackRanges?.[0];
      expect(range).toMatchObject({
        eligibleSpecimenKinds: ["serum"],
        unit: expected.unit,
        lowerBound: { inclusive: true, value: expected.lowerBound },
        upperBound: { inclusive: true, value: expected.upperBound },
        source: {
          title: expected.title,
          organization: "Mayo Clinic Laboratories",
          year: 2026,
          sourceType: "assay_documentation",
          url: expected.url,
        },
      });
    }
  });

  it("deliberately omits fallback ranges when interpretation needs result context", () => {
    for (const entityKey of REPRESENTATIVE_CONTEXT_DEPENDENT_FALLBACK_OMISSIONS) {
      const guidance = pagesByKey.get(entityKey)?.frontmatter.referenceGuidance;
      expect(guidance, entityKey).toBeDefined();
      expect(guidance?.fallbackRanges, entityKey).toBeUndefined();
    }
  });

  it("does not repurpose clinical decision values as display fallback ranges", () => {
    for (const entityKey of DECISION_NUMERIC_VALUES_THAT_MUST_NOT_BECOME_FALLBACKS) {
      const guidance = pagesByKey.get(entityKey)?.frontmatter.referenceGuidance;
      expect(guidance, entityKey).toBeDefined();
      expect(
        guidance?.items.some((item) => (item.numericValues?.length ?? 0) > 0),
        entityKey,
      ).toBe(true);
      expect(guidance?.fallbackRanges, entityKey).toBeUndefined();
    }
  });

  it("preserves comparator semantics instead of manufacturing exact points", () => {
    const belowTen = healthCommonsBiomarkerGuidanceNumericValueSchema.parse({
      label: "Below-ten comparator",
      unit: "example-unit",
      upperBound: { inclusive: false, value: 10 },
    });

    expect(belowTen).toEqual({
      label: "Below-ten comparator",
      unit: "example-unit",
      upperBound: { inclusive: false, value: 10 },
    });
    expect(() => healthCommonsBiomarkerGuidanceNumericValueSchema.parse({
      label: "Unbounded value",
      unit: "example-unit",
    })).toThrow();
    expect(() => healthCommonsBiomarkerGuidanceNumericValueSchema.parse({
      label: "Reversed interval",
      lowerBound: { inclusive: true, value: 10 },
      unit: "example-unit",
      upperBound: { inclusive: true, value: 5 },
    })).toThrow();
    expect(() => healthCommonsBiomarkerGuidanceNumericValueSchema.parse({
      label: "Collapsed exact point",
      lowerBound: { inclusive: true, value: 10 },
      unit: "example-unit",
      upperBound: { inclusive: true, value: 10 },
    })).toThrow();
  });
});
