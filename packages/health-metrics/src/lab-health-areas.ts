import {
  normalizeMetricKey,
  resolveLabResultMetricDefinition,
  resolveLabResultMetricDefinitionForBiomarker,
} from "./catalog.ts";

export const LAB_HEALTH_AREA_IDS = [
  "blood-sugar",
  "heart-lipids",
  "kidneys",
  "liver",
  "thyroid",
  "blood",
  "hormones",
  "nutrients",
  "inflammation",
  "electrolytes",
  "muscle-tissue",
  "environmental",
  "prostate",
  "other",
] as const;

export type LabHealthAreaId = (typeof LAB_HEALTH_AREA_IDS)[number];

export interface LabHealthArea {
  readonly id: LabHealthAreaId;
  readonly label: string;
}

export interface LabHealthAreaGroup<T> {
  readonly area: LabHealthArea;
  readonly items: readonly T[];
}

const OTHER_LAB_HEALTH_AREA: LabHealthArea = Object.freeze({
  id: "other",
  label: "Other",
});

export const LAB_HEALTH_AREAS: readonly LabHealthArea[] = Object.freeze([
  Object.freeze({ id: "blood-sugar", label: "Blood sugar" }),
  Object.freeze({ id: "heart-lipids", label: "Heart & lipids" }),
  Object.freeze({ id: "kidneys", label: "Kidneys" }),
  Object.freeze({ id: "liver", label: "Liver" }),
  Object.freeze({ id: "thyroid", label: "Thyroid" }),
  Object.freeze({ id: "blood", label: "Blood" }),
  Object.freeze({ id: "hormones", label: "Hormones" }),
  Object.freeze({ id: "nutrients", label: "Nutrients & fatty acids" }),
  Object.freeze({ id: "inflammation", label: "Inflammation & immune" }),
  Object.freeze({ id: "electrolytes", label: "Electrolytes" }),
  Object.freeze({ id: "muscle-tissue", label: "Muscle & tissue" }),
  Object.freeze({ id: "environmental", label: "Environmental exposure" }),
  Object.freeze({ id: "prostate", label: "Prostate health" }),
  OTHER_LAB_HEALTH_AREA,
]);

const LAB_HEALTH_AREA_KEYS: Readonly<Record<LabHealthAreaId, readonly string[]>> = {
  "blood-sugar": [
    "glucose",
    "blood-glucose",
    "fasting-glucose",
    "plasma-glucose",
    "random-glucose",
    "serum-glucose",
    "hba1c",
    "a1c",
    "hemoglobin-a1c",
    "insulin",
    "fasting-insulin",
    "serum-insulin",
    "c-peptide",
    "fructosamine",
  ],
  "heart-lipids": [
    "apob",
    "apolipoprotein-b",
    "ldl-c",
    "ldl-cholesterol",
    "ldl-calculated",
    "ldl-chol-calc-nih",
    "hdl-c",
    "hdl-cholesterol",
    "triglycerides",
    "total-cholesterol",
    "cholesterol-total",
    "non-hdl-cholesterol",
    "vldl-cholesterol",
    "vldl-cholesterol-cal",
    "vldl-cholesterol-calculated",
    "lipoprotein-a",
    "lpa",
    "apolipoprotein-a1",
    "apoa1",
    "cholesterol-hdl-ratio",
    "ldl-large-particles",
    "ldl-medium-particles",
    "ldl-particle-number",
    "ldl-pattern",
    "ldl-peak-size",
    "ldl-small-particles",
    "homocysteine",
    "poc-troponin-i",
  ],
  kidneys: [
    "creatinine",
    "serum-creatinine",
    "egfr",
    "estimated-glomerular-filtration-rate",
    "egfr-ckd-epi",
    "estimated-gfr-ckd-epi",
    "gfr-mdrd-af-amer",
    "gfr-mdrd-non-af-amer",
    "bun",
    "blood-urea-nitrogen",
    "urea-nitrogen",
    "bun-creatinine-ratio",
    "cystatin-c",
    "urine-albumin",
    "urine-microalbumin",
    "albumin-creatinine-ratio",
    "urine-albumin-creatinine-ratio",
    "urine-protein",
    "uric-acid",
    "urine-albumin-random-without-creatinine",
  ],
  liver: [
    "albumin",
    "alt",
    "alanine-aminotransferase",
    "ast",
    "aspartate-aminotransferase",
    "ggt",
    "gamma-glutamyl-transferase",
    "alkaline-phosphatase",
    "bilirubin",
    "total-bilirubin",
    "direct-bilirubin",
    "indirect-bilirubin",
    "total-protein",
    "globulin",
    "total-globulin",
    "albumin-globulin-ratio",
    "fib4",
  ],
  thyroid: [
    "tsh",
    "thyroid-stimulating-hormone",
    "t4",
    "thyroxine",
    "free-t4",
    "t3",
    "triiodothyronine",
    "free-t3",
    "thyroid-peroxidase-antibody",
    "tpo-antibody",
    "thyroglobulin-antibody",
    "thyroglobulin-antibodies",
    "thyroid-peroxidase-antibodies",
  ],
  blood: [
    "white-blood-cell-count",
    "wbc",
    "lymphocyte-percentage",
    "lymphocytes",
    "mean-corpuscular-volume",
    "mcv",
    "red-cell-distribution-width",
    "rdw",
    "red-blood-cell-count",
    "rbc",
    "hemoglobin",
    "hematocrit",
    "platelet-count",
    "platelets",
    "neutrophils",
    "absolute-neutrophils",
    "monocytes",
    "absolute-monocytes",
    "eosinophils",
    "absolute-eosinophils",
    "basophils",
    "absolute-basophils",
    "mean-corpuscular-hemoglobin",
    "mch",
    "mean-corpuscular-hemoglobin-concentration",
    "mchc",
    "mean-platelet-volume",
    "mpv",
    "neutrophil-percentage",
    "absolute-neutrophils",
    "absolute-lymphocytes",
    "monocyte-percentage",
    "absolute-monocytes",
    "eosinophil-percentage",
    "absolute-eosinophils",
    "basophil-percentage",
    "absolute-basophils",
    "immature-granulocyte-percentage",
    "absolute-immature-granulocytes",
  ],
  hormones: [
    "testosterone",
    "total-testosterone",
    "free-testosterone",
    "estradiol",
    "progesterone",
    "sex-hormone-binding-globulin",
    "shbg",
    "follicle-stimulating-hormone",
    "fsh",
    "luteinizing-hormone",
    "lh",
    "dhea-sulfate",
    "dheas",
    "cortisol",
    "prolactin",
    "igf-1",
  ],
  nutrients: [
    "ferritin",
    "iron",
    "serum-iron",
    "total-iron-binding-capacity",
    "tibc",
    "transferrin",
    "transferrin-saturation",
    "vitamin-d",
    "25-hydroxy-vitamin-d",
    "vitamin-d-25-hydroxy",
    "vitamin-b12",
    "b12",
    "folate",
    "zinc",
    "copper",
    "selenium",
    "iron-saturation",
    "magnesium-rbc",
    "methylmalonic-acid",
    "arachidonic-acid",
    "arachidonic-acid-epa-ratio",
    "dha",
    "dpa",
    "epa",
    "linoleic-acid",
    "omega-3-total-omegacheck",
    "omega-3-total-omega-check",
    "omega-6-3-ratio",
    "omega-6-total",
    "omega-3-total",
    "omegacheck-total",
    "omega-check-total",
  ],
  inflammation: [
    "hs-crp",
    "crp",
    "c-reactive-protein",
    "high-sensitivity-c-reactive-protein",
    "erythrocyte-sedimentation-rate",
    "sedimentation-rate",
    "esr",
    "ana-screen",
    "rheumatoid-factor",
  ],
  electrolytes: [
    "sodium",
    "potassium",
    "chloride",
    "carbon-dioxide",
    "co2",
    "bicarbonate",
    "calcium",
    "magnesium",
    "phosphorus",
    "phosphate",
    "adjusted-calcium",
    "anion-gap",
  ],
  "muscle-tissue": [
    "creatine-kinase",
    "creatine-phosphokinase",
    "ck",
    "ldh",
    "lactate-dehydrogenase",
  ],
  environmental: [
    "lead",
    "mercury",
  ],
  prostate: [
    "psa-total",
    "total-psa",
    "psa-free",
    "free-psa",
    "psa-percent-free",
  ],
  other: [],
};

const LAB_HEALTH_AREA_BY_KEY = new Map<string, LabHealthArea>();

for (const area of LAB_HEALTH_AREAS) {
  for (const key of LAB_HEALTH_AREA_KEYS[area.id]) {
    LAB_HEALTH_AREA_BY_KEY.set(normalizeMetricKey(key), area);
  }
}

export function listLabHealthAreas(): LabHealthArea[] {
  return LAB_HEALTH_AREAS.slice();
}

/**
 * Resolves a lab metric, analyte label, or biomarker key to a display-only
 * navigation group. The result does not interpret the member's value.
 */
export function resolveLabHealthArea(value: string): LabHealthArea {
  return resolveIndexedLabHealthArea(value) ?? OTHER_LAB_HEALTH_AREA;
}

/**
 * Resolves only analytes that are intentionally admitted to the member-facing
 * Biomarkers index. A null result preserves the underlying lab row while
 * keeping report metadata, procedures, screens, and unknown fields out of the
 * index until an owner classifies them explicitly.
 */
export function resolveIndexedLabHealthArea(value: string): LabHealthArea | null {
  const key = resolveLabHealthAreaLookupKey(value);
  return LAB_HEALTH_AREA_BY_KEY.get(key) ?? null;
}

/**
 * Groups lab items in the stable member-facing area order while preserving the
 * original order of items within each area. Empty areas are omitted.
 */
export function groupLabItemsByHealthArea<T>(
  items: readonly T[],
  getMetricOrAnalyteKey: (item: T) => string,
): LabHealthAreaGroup<T>[] {
  const itemsByArea = new Map<LabHealthAreaId, T[]>();

  for (const item of items) {
    const area = resolveLabHealthArea(getMetricOrAnalyteKey(item));
    const areaItems = itemsByArea.get(area.id);
    if (areaItems) {
      areaItems.push(item);
    } else {
      itemsByArea.set(area.id, [item]);
    }
  }

  return LAB_HEALTH_AREAS.flatMap((area) => {
    const areaItems = itemsByArea.get(area.id);
    return areaItems ? [{ area, items: areaItems }] : [];
  });
}

function resolveLabHealthAreaLookupKey(value: string): string {
  const trimmed = value.trim();
  const definition = resolveLabResultMetricDefinition(trimmed)
    ?? resolveLabResultMetricDefinitionForBiomarker(trimmed);

  if (definition?.category === "lab") {
    return definition.key;
  }

  const withoutBiomarkerPrefix = trimmed.toLowerCase().startsWith("biomarker:")
    ? trimmed.slice("biomarker:".length)
    : trimmed;
  return normalizeMetricKey(withoutBiomarkerPrefix);
}
