import type {
  HealthCommonsBiomarkerFallbackRange,
} from "@murphai/contracts";

export type BiomarkerFallbackRangeForDisplay = Pick<
  HealthCommonsBiomarkerFallbackRange,
  | "applicability"
  | "eligibleSpecimenKinds"
  | "label"
  | "lowerBound"
  | "unit"
  | "upperBound"
>;

type ReviewedRangeInput = Omit<
  HealthCommonsBiomarkerFallbackRange,
  "eligibleSpecimenKinds"
> & {
  eligibleSpecimenKinds?: HealthCommonsBiomarkerFallbackRange["eligibleSpecimenKinds"];
};

function reviewedRange(
  input: ReviewedRangeInput,
): HealthCommonsBiomarkerFallbackRange {
  return {
    ...input,
    eligibleSpecimenKinds: input.eligibleSpecimenKinds ?? ["serum"],
  };
}

function mayoAssaySource(
  title: string,
  url: string,
): HealthCommonsBiomarkerFallbackRange["source"] {
  return {
    organization: "Mayo Clinic Laboratories",
    sourceType: "assay_documentation",
    title,
    url,
    year: 2026,
  };
}

const SOURCE_AUTHORITY =
  "source-laboratory flags and per-result ranges remain authoritative.";

const ADULT_SERUM_CONTEXT =
  `For published adult comparison on serum results when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, and ${SOURCE_AUTHORITY}`;

const ADULT_CARDIOVASCULAR_CONTEXT =
  `For published adult cardiovascular context on serum results when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range or an individualized treatment goal, and ${SOURCE_AUTHORITY}`;

export const REVIEWED_BIOMARKER_FALLBACK_RANGES: Readonly<Record<
  string,
  readonly HealthCommonsBiomarkerFallbackRange[]
>> = {
  "biomarker:albumin": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} Hydration and assay method can still affect interpretation.`,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 3.5 },
      source: mayoAssaySource(
        "Albumin, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/800000",
      ),
      unit: "g/dL",
      upperBound: { inclusive: true, value: 5 },
    }),
  ],
  "biomarker:anion-gap": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} The laboratory's electrolyte methods, formula, and albumin context remain relevant.`,
      label: "Mayo Clinic Laboratories serum calculation interval",
      lowerBound: { inclusive: true, value: 7 },
      source: mayoAssaySource(
        "Basic Metabolic Panel, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/113630",
      ),
      unit: "mmol/L",
      upperBound: { inclusive: true, value: 15 },
    }),
  ],
  "biomarker:egfr": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} This boundary is intended for adult eGFR results; equation version, chronicity, body-size context, and urine findings still matter.`,
      label: "Mayo Clinic Laboratories adult kidney-function comparator",
      lowerBound: { inclusive: true, value: 60 },
      source: mayoAssaySource(
        "Creatinine with Estimated Glomerular Filtration Rate (eGFR), Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/48216",
      ),
      unit: "mL/min/1.73m^2",
    }),
  ],
  "biomarker:egfr-ckd-epi": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} This boundary applies to adult results calculated with the 2021 CKD-EPI creatinine equation; chronicity and urine findings still matter.`,
      label: "Mayo Clinic Laboratories 2021 CKD-EPI adult comparator",
      lowerBound: { inclusive: true, value: 60 },
      source: mayoAssaySource(
        "Creatinine with Estimated Glomerular Filtration Rate (eGFR), Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/48216",
      ),
      unit: "mL/min/1.73m^2",
    }),
  ],
  "biomarker:total-cholesterol": [
    reviewedRange({
      applicability: ADULT_CARDIOVASCULAR_CONTEXT,
      label: "Published adult desirable-value comparator",
      source: mayoAssaySource(
        "Cholesterol, Total, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/8320",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: false, value: 200 },
    }),
  ],
  "biomarker:ldl-c": [
    reviewedRange({
      applicability: ADULT_CARDIOVASCULAR_CONTEXT,
      label: "Published adult LDL-C desirable-value comparator",
      source: mayoAssaySource(
        "Lipid Panel, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/616696",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: false, value: 100 },
    }),
  ],
  "biomarker:ldl-calculated": [
    reviewedRange({
      applicability: `${ADULT_CARDIOVASCULAR_CONTEXT} Formula identity and triglyceride context remain part of the result.`,
      label: "Published adult calculated LDL-C comparator",
      source: mayoAssaySource(
        "Lipid Panel, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/616696",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: false, value: 100 },
    }),
  ],
  "biomarker:ldl-chol-calc-nih": [
    reviewedRange({
      applicability: `${ADULT_CARDIOVASCULAR_CONTEXT} This value remains tied to the named NIH or Sampson calculation and its input panel.`,
      label: "Published adult NIH-calculated LDL-C comparator",
      source: mayoAssaySource(
        "Lipid Panel, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/616696",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: false, value: 100 },
    }),
  ],
  "biomarker:non-hdl-cholesterol": [
    reviewedRange({
      applicability: ADULT_CARDIOVASCULAR_CONTEXT,
      label: "Published adult non-HDL desirable-value comparator",
      source: mayoAssaySource(
        "Lipid Panel, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/616696",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: false, value: 130 },
    }),
  ],
  "biomarker:triglycerides": [
    reviewedRange({
      applicability: `${ADULT_CARDIOVASCULAR_CONTEXT} Fasting state, alcohol, illness, and treatment context can change interpretation.`,
      label: "Published adult triglyceride comparator",
      source: mayoAssaySource(
        "Lipid Panel, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/616696",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: false, value: 150 },
    }),
  ],
  "biomarker:apolipoprotein-b": [
    reviewedRange({
      applicability: ADULT_CARDIOVASCULAR_CONTEXT,
      label: "Mayo Clinic Laboratories adult ApoB comparator",
      source: mayoAssaySource(
        "Apolipoprotein B, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/614544",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: false, value: 90 },
    }),
  ],
  "biomarker:lipoprotein-a": [
    reviewedRange({
      applicability: `${ADULT_CARDIOVASCULAR_CONTEXT} Particle concentration and mass concentration are not treated as interchangeable.`,
      label: "Mayo Clinic Laboratories adult lipoprotein(a) comparator",
      source: mayoAssaySource(
        "Lipoprotein(a), Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/615007",
      ),
      unit: "nmol/L",
      upperBound: { inclusive: false, value: 75 },
    }),
  ],
  "biomarker:hs-crp": [
    reviewedRange({
      applicability: `${ADULT_CARDIOVASCULAR_CONTEXT} Acute illness, injury, and recent inflammation can transiently raise hs-CRP.`,
      label: "Mayo Clinic Laboratories adult hs-CRP comparator",
      source: mayoAssaySource(
        "C-Reactive Protein, High Sensitivity, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/800024",
      ),
      unit: "mg/L",
      upperBound: { inclusive: false, value: 2 },
    }),
  ],
  "biomarker:ferritin": [
    reviewedRange({
      applicability: `For published adult iron-status context on serum or plasma results when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, inflammation can make a higher decision boundary relevant, and ${SOURCE_AUTHORITY}`,
      eligibleSpecimenKinds: ["serum", "plasma"],
      label: "WHO adult iron-deficiency decision comparator",
      source: {
        organization: "World Health Organization",
        sourceType: "clinical_guideline",
        title: "WHO guideline on use of ferritin concentrations to assess iron status in individuals and populations",
        url: "https://www.who.int/publications/i/item/9789240000124",
        year: 2020,
      },
      unit: "ng/mL",
      upperBound: { inclusive: false, value: 15 },
    }),
  ],
  "biomarker:serum-25-hydroxyvitamin-d": [
    reviewedRange({
      applicability: `For published adult bone-health context on serum results when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, guidance organizations differ on universal targets, and ${SOURCE_AUTHORITY}`,
      label: "Mayo Clinic Laboratories 25-hydroxyvitamin D decision interval",
      lowerBound: { inclusive: true, value: 20 },
      source: mayoAssaySource(
        "25-Hydroxyvitamin D2 and D3, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/83670",
      ),
      unit: "ng/mL",
      upperBound: { inclusive: true, value: 50 },
    }),
    reviewedRange({
      applicability: `For published adult bone-health context on serum results when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, guidance organizations differ on universal targets, and ${SOURCE_AUTHORITY}`,
      label: "Mayo Clinic Laboratories 25-hydroxyvitamin D decision interval",
      lowerBound: { inclusive: true, value: 50 },
      source: mayoAssaySource(
        "25-Hydroxyvitamin D2 and D3, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/83670",
      ),
      unit: "nmol/L",
      upperBound: { inclusive: true, value: 125 },
    }),
  ],
  "biomarker:total-iron-binding-capacity": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 250 },
      source: mayoAssaySource(
        "Total Iron-Binding Capacity, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/2501",
      ),
      unit: "mcg/dL",
      upperBound: { inclusive: true, value: 400 },
    }),
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 250 },
      source: mayoAssaySource(
        "Total Iron-Binding Capacity, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/2501",
      ),
      unit: "mcg/dL (calc)",
      upperBound: { inclusive: true, value: 400 },
    }),
  ],
  "biomarker:iron-saturation": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 14 },
      source: mayoAssaySource(
        "Percent Saturation, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/2503",
      ),
      unit: "percent",
      upperBound: { inclusive: true, value: 50 },
    }),
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 14 },
      source: mayoAssaySource(
        "Percent Saturation, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/2503",
      ),
      unit: "% (calc)",
      upperBound: { inclusive: true, value: 50 },
    }),
  ],
  "biomarker:zinc": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} Collection timing, fasting, supplements, inflammation, and trace-element contamination can affect the result.`,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 60 },
      source: mayoAssaySource(
        "Zinc, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/7735",
      ),
      unit: "mcg/dL",
      upperBound: { inclusive: true, value: 106 },
    }),
  ],
  "biomarker:methylmalonic-acid": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} Kidney function and the named assay remain relevant.`,
      label: "Mayo Clinic Laboratories serum upper comparator",
      source: mayoAssaySource(
        "Methylmalonic Acid, Quantitative, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/80289",
      ),
      unit: "nmol/L",
      upperBound: { inclusive: true, value: 400 },
    }),
  ],
  "biomarker:rheumatoid-factor": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} This result is contextual and is not a stand-alone clinical conclusion.`,
      label: "Mayo Clinic Laboratories serum upper comparator",
      source: mayoAssaySource(
        "Rheumatoid Factor, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/603415",
      ),
      unit: "IU/mL",
      upperBound: { inclusive: false, value: 15 },
    }),
  ],
  "biomarker:thyroglobulin-antibodies": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} Assay method and thyroid context remain relevant.`,
      label: "Mayo Clinic Laboratories serum upper comparator",
      source: mayoAssaySource(
        "Thyroglobulin Antibody, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/84382",
      ),
      unit: "IU/mL",
      upperBound: { inclusive: false, value: 4 },
    }),
  ],
  "biomarker:thyroid-peroxidase-antibodies": [
    reviewedRange({
      applicability: `${ADULT_SERUM_CONTEXT} Assay method and thyroid context remain relevant.`,
      label: "Mayo Clinic Laboratories serum upper comparator",
      source: mayoAssaySource(
        "Thyroperoxidase Antibodies, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/81765",
      ),
      unit: "IU/mL",
      upperBound: { inclusive: false, value: 9 },
    }),
  ],
};

export function listReviewedBiomarkerFallbackRanges(): ReadonlyArray<{
  entityKey: string;
  ranges: readonly HealthCommonsBiomarkerFallbackRange[];
}> {
  return Object.entries(REVIEWED_BIOMARKER_FALLBACK_RANGES).map(
    ([entityKey, ranges]) => ({ entityKey, ranges }),
  );
}

export function resolveReviewedBiomarkerFallbackRanges(
  entityKey: string,
): BiomarkerFallbackRangeForDisplay[] {
  return (REVIEWED_BIOMARKER_FALLBACK_RANGES[entityKey] ?? []).map(
    (range) => ({
      applicability: range.applicability,
      eligibleSpecimenKinds: [...range.eligibleSpecimenKinds],
      label: range.label,
      ...(range.lowerBound ? { lowerBound: { ...range.lowerBound } } : {}),
      unit: range.unit,
      ...(range.upperBound ? { upperBound: { ...range.upperBound } } : {}),
    }),
  );
}
