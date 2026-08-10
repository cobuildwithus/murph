export type BiomarkerFallbackSpecimenKind = "plasma" | "serum" | "whole_blood";

export interface BiomarkerFallbackRangeBound {
  inclusive: boolean;
  value: number;
}

export interface BiomarkerFallbackRangeSource {
  organization: string;
  sourceType:
    | "academic_reference"
    | "assay_documentation"
    | "clinical_guideline"
    | "consensus_statement"
    | "primary_literature"
    | "regulatory_guidance"
    | "systematic_review";
  title: string;
  url?: string;
  year: number;
}

export interface BiomarkerFallbackRange {
  applicability: string;
  eligibleSpecimenKinds: BiomarkerFallbackSpecimenKind[];
  label: string;
  lowerBound?: BiomarkerFallbackRangeBound;
  source: BiomarkerFallbackRangeSource;
  unit: string;
  upperBound?: BiomarkerFallbackRangeBound;
}

export type BiomarkerFallbackStatusDisposition =
  | "above_range"
  | "below_range"
  | "in_range"
  | "reported";

export interface BiomarkerFallbackStatusMapping {
  above: BiomarkerFallbackStatusDisposition;
  below: BiomarkerFallbackStatusDisposition;
  within: BiomarkerFallbackStatusDisposition;
}

export type BiomarkerFallbackRangeForDisplay = Omit<
  BiomarkerFallbackRange,
  "source"
>;

export interface BiomarkerFallbackStatusRange
  extends BiomarkerFallbackRangeForDisplay {
  statusMapping: BiomarkerFallbackStatusMapping;
}

export interface ReviewedBiomarkerFallbackRange {
  /** Page-authored ranges can be mirrored for client status derivation only. */
  displayFallback: boolean;
  range: BiomarkerFallbackRange;
  statusMapping: BiomarkerFallbackStatusMapping;
}

type ReviewedRangeInput = Omit<
  BiomarkerFallbackRange,
  "eligibleSpecimenKinds"
> & {
  eligibleSpecimenKinds?: BiomarkerFallbackRange["eligibleSpecimenKinds"];
};

const STANDARD_STATUS_MAPPING: BiomarkerFallbackStatusMapping = Object.freeze({
  above: "above_range",
  below: "below_range",
  within: "in_range",
});

const CONTEXT_ONLY_STATUS_MAPPING: BiomarkerFallbackStatusMapping = Object.freeze({
  above: "reported",
  below: "reported",
  within: "reported",
});

function reviewedRange(
  input: ReviewedRangeInput,
  statusMapping: BiomarkerFallbackStatusMapping = STANDARD_STATUS_MAPPING,
  options: { displayFallback?: boolean } = {},
): ReviewedBiomarkerFallbackRange {
  return {
    displayFallback: options.displayFallback ?? true,
    range: {
      ...input,
      eligibleSpecimenKinds: input.eligibleSpecimenKinds ?? ["serum"],
    },
    statusMapping,
  };
}

function mayoAssaySource(
  title: string,
  url: string,
): BiomarkerFallbackRangeSource {
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

const ADULT_THYROID_CONTEXT =
  `For published adult thyroid comparison on serum results when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, pregnancy, illness, medications, biotin, and assay method can change interpretation, and ${SOURCE_AUTHORITY}`;

const ADULT_WHOLE_BLOOD_CONTEXT =
  `For published adult comparison on whole-blood results when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, analyzer and local reference-population differences can still matter, and ${SOURCE_AUTHORITY}`;

export const REVIEWED_BIOMARKER_FALLBACK_RANGES: Readonly<Record<
  string,
  readonly ReviewedBiomarkerFallbackRange[]
>> = {
  // These eight values remain page-authored for public detail context. The
  // runtime mirrors are status-only and are parity-tested against that content.
  "biomarker:bilirubin": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 0 },
      source: mayoAssaySource(
        "Bilirubin, Total, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/81785",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: true, value: 1.2 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
  "biomarker:carbon-dioxide": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 22 },
      source: mayoAssaySource(
        "Bicarbonate, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/876",
      ),
      unit: "mmol/L",
      upperBound: { inclusive: true, value: 29 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
  "biomarker:chloride": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 98 },
      source: mayoAssaySource(
        "Chloride, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/8460",
      ),
      unit: "mmol/L",
      upperBound: { inclusive: true, value: 107 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
  "biomarker:ldh": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 122 },
      source: mayoAssaySource(
        "Lactate Dehydrogenase (LDH), Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/8344",
      ),
      unit: "U/L",
      upperBound: { inclusive: true, value: 222 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
  "biomarker:phosphate": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 2.5 },
      source: mayoAssaySource(
        "Phosphorus (Inorganic), Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/8408",
      ),
      unit: "mg/dL",
      upperBound: { inclusive: true, value: 4.5 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
  "biomarker:potassium": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 3.6 },
      source: mayoAssaySource(
        "Potassium, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/602352",
      ),
      unit: "mmol/L",
      upperBound: { inclusive: true, value: 5.2 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
  "biomarker:sodium": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 135 },
      source: mayoAssaySource(
        "Sodium, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/602353",
      ),
      unit: "mmol/L",
      upperBound: { inclusive: true, value: 145 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
  "biomarker:total-protein": [
    reviewedRange({
      applicability: ADULT_SERUM_CONTEXT,
      label: "Mayo Clinic Laboratories serum reference interval",
      lowerBound: { inclusive: true, value: 6.3 },
      source: mayoAssaySource(
        "Protein, Total, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/8520",
      ),
      unit: "g/dL",
      upperBound: { inclusive: true, value: 7.9 },
    }, STANDARD_STATUS_MAPPING, { displayFallback: false }),
  ],
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
    }, STANDARD_STATUS_MAPPING),
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
    }, STANDARD_STATUS_MAPPING),
  ],
  "biomarker:free-t3": [
    reviewedRange({
      applicability: ADULT_THYROID_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 2 },
      source: mayoAssaySource(
        "T3 (Triiodothyronine), Free, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/621815",
      ),
      unit: "pg/mL",
      upperBound: { inclusive: true, value: 4.4 },
    }),
  ],
  "biomarker:free-t4": [
    reviewedRange({
      applicability: ADULT_THYROID_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 0.9 },
      source: mayoAssaySource(
        "T4 (Thyroxine), Free, Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/8725",
      ),
      unit: "ng/dL",
      upperBound: { inclusive: true, value: 1.7 },
    }),
  ],
  "biomarker:thyroid-stimulating-hormone": [
    reviewedRange({
      applicability: ADULT_THYROID_CONTEXT,
      label: "Mayo Clinic Laboratories adult serum reference interval",
      lowerBound: { inclusive: true, value: 0.3 },
      source: mayoAssaySource(
        "Thyroid-Stimulating Hormone-Sensitive (s-TSH), Serum",
        "https://www.mayocliniclabs.com/test-catalog/Overview/8939",
      ),
      unit: "mIU/L",
      upperBound: { inclusive: true, value: 4.2 },
    }),
  ],
  "biomarker:white-blood-cell-count": [
    reviewedRange({
      applicability: ADULT_WHOLE_BLOOD_CONTEXT,
      eligibleSpecimenKinds: ["whole_blood"],
      label: "Mayo Clinic Laboratories adult whole-blood reference interval",
      lowerBound: { inclusive: true, value: 3.4 },
      source: mayoAssaySource(
        "Complete Blood Cell Count with Differential, Blood",
        "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
      ),
      unit: "10^3/uL",
      upperBound: { inclusive: true, value: 9.6 },
    }),
  ],
  "biomarker:mean-corpuscular-volume": [
    reviewedRange({
      applicability: ADULT_WHOLE_BLOOD_CONTEXT,
      eligibleSpecimenKinds: ["whole_blood"],
      label: "Mayo Clinic Laboratories adult whole-blood reference interval",
      lowerBound: { inclusive: true, value: 78.2 },
      source: mayoAssaySource(
        "Complete Blood Cell Count with Differential, Blood",
        "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
      ),
      unit: "fL",
      upperBound: { inclusive: true, value: 97.9 },
    }),
  ],
  "biomarker:absolute-neutrophils": [
    reviewedRange({
      applicability: ADULT_WHOLE_BLOOD_CONTEXT,
      eligibleSpecimenKinds: ["whole_blood"],
      label: "Mayo Clinic Laboratories adult whole-blood reference interval",
      lowerBound: { inclusive: true, value: 1.56 },
      source: mayoAssaySource(
        "Complete Blood Cell Count with Differential, Blood",
        "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
      ),
      unit: "10^3/uL",
      upperBound: { inclusive: true, value: 6.45 },
    }),
  ],
  "biomarker:absolute-lymphocytes": [
    reviewedRange({
      applicability: ADULT_WHOLE_BLOOD_CONTEXT,
      eligibleSpecimenKinds: ["whole_blood"],
      label: "Mayo Clinic Laboratories adult whole-blood reference interval",
      lowerBound: { inclusive: true, value: 0.95 },
      source: mayoAssaySource(
        "Complete Blood Cell Count with Differential, Blood",
        "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
      ),
      unit: "10^3/uL",
      upperBound: { inclusive: true, value: 3.07 },
    }),
  ],
  "biomarker:absolute-monocytes": [
    reviewedRange({
      applicability: ADULT_WHOLE_BLOOD_CONTEXT,
      eligibleSpecimenKinds: ["whole_blood"],
      label: "Mayo Clinic Laboratories adult whole-blood reference interval",
      lowerBound: { inclusive: true, value: 0.26 },
      source: mayoAssaySource(
        "Complete Blood Cell Count with Differential, Blood",
        "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
      ),
      unit: "10^3/uL",
      upperBound: { inclusive: true, value: 0.81 },
    }),
  ],
  "biomarker:absolute-eosinophils": [
    reviewedRange({
      applicability: ADULT_WHOLE_BLOOD_CONTEXT,
      eligibleSpecimenKinds: ["whole_blood"],
      label: "Mayo Clinic Laboratories adult whole-blood reference interval",
      lowerBound: { inclusive: true, value: 0.03 },
      source: mayoAssaySource(
        "Complete Blood Cell Count with Differential, Blood",
        "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
      ),
      unit: "10^3/uL",
      upperBound: { inclusive: true, value: 0.48 },
    }),
  ],
  "biomarker:absolute-basophils": [
    reviewedRange({
      applicability: ADULT_WHOLE_BLOOD_CONTEXT,
      eligibleSpecimenKinds: ["whole_blood"],
      label: "Mayo Clinic Laboratories adult whole-blood reference interval",
      lowerBound: { inclusive: true, value: 0.01 },
      source: mayoAssaySource(
        "Complete Blood Cell Count with Differential, Blood",
        "https://www.mayocliniclabs.com/test-catalog/Overview/9109",
      ),
      unit: "10^3/uL",
      upperBound: { inclusive: true, value: 0.08 },
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
    }, CONTEXT_ONLY_STATUS_MAPPING),
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
  ranges: readonly ReviewedBiomarkerFallbackRange[];
}> {
  return Object.entries(REVIEWED_BIOMARKER_FALLBACK_RANGES).map(
    ([entityKey, ranges]) => ({ entityKey, ranges }),
  );
}

export function resolveReviewedBiomarkerFallbackRanges(
  entityKey: string,
): BiomarkerFallbackRangeForDisplay[] {
  return cloneDisplayRanges(entityKey);
}

export function resolveBiomarkerFallbackStatusRanges(
  entityKey: string,
): BiomarkerFallbackStatusRange[] {
  const resolvedKey = BIOMARKER_FALLBACK_ENTITY_ALIASES[entityKey] ?? entityKey;
  return (REVIEWED_BIOMARKER_FALLBACK_RANGES[resolvedKey] ?? []).map(
    ({ range, statusMapping }) => ({
      ...cloneDisplayRange(range),
      statusMapping: cloneStatusMapping(statusMapping),
    }),
  );
}

function cloneDisplayRanges(
  entityKey: string,
): BiomarkerFallbackRangeForDisplay[] {
  const resolvedKey = BIOMARKER_FALLBACK_ENTITY_ALIASES[entityKey] ?? entityKey;
  return (REVIEWED_BIOMARKER_FALLBACK_RANGES[resolvedKey] ?? [])
    .filter((entry) => entry.displayFallback)
    .map(({ range }) => cloneDisplayRange(range));
}

function cloneDisplayRange(
  range: BiomarkerFallbackRange,
): BiomarkerFallbackRangeForDisplay {
  return {
    applicability: range.applicability,
    eligibleSpecimenKinds: [...range.eligibleSpecimenKinds],
    label: range.label,
    ...(range.lowerBound ? { lowerBound: { ...range.lowerBound } } : {}),
    unit: range.unit,
    ...(range.upperBound ? { upperBound: { ...range.upperBound } } : {}),
  };
}

const BIOMARKER_FALLBACK_ENTITY_ALIASES: Readonly<Record<string, string>> = {
  "biomarker:apob": "biomarker:apolipoprotein-b",
  "biomarker:total-bilirubin": "biomarker:bilirubin",
  "biomarker:vitamin-d": "biomarker:serum-25-hydroxyvitamin-d",
};

function cloneStatusMapping(
  mapping: BiomarkerFallbackStatusMapping,
): BiomarkerFallbackStatusMapping {
  return {
    above: mapping.above,
    below: mapping.below,
    within: mapping.within,
  };
}
