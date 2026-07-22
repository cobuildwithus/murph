export type BiomarkerStudyStatus = "in-range" | "reported" | "review";

export interface BiomarkerStudyResult {
  metricKey: string;
  name: string;
  status: BiomarkerStudyStatus;
  statusLabel: string;
  unit: string | null;
  value: string;
}

export interface BiomarkerStudyGroup {
  id: string;
  label: string;
  results: readonly BiomarkerStudyResult[];
}

export interface BiomarkerDeviceStudy {
  category: string;
  metricKey: string;
  name: string;
  summary: string;
  unit: string;
  value: string;
}

export const BIOMARKER_DEVICE_STUDIES: readonly BiomarkerDeviceStudy[] = [
  {
    category: "Sleep",
    metricKey: "deep-sleep-minutes",
    name: "Deep sleep",
    summary: "Time spent in slow-wave sleep each night, where the brain's deepest electrical slowdown drives growth-hormone release, tissue repair, and waste clearance that lighter stages do not match.",
    unit: "minutes",
    value: "96",
  },
  {
    category: "Recovery",
    metricKey: "hrv-rmssd",
    name: "HRV",
    summary: "Beat-to-beat variation in heart timing measured at rest, where more variation signals stronger vagal brake on the heart and a nervous system with room to respond rather than one stuck in overdrive.",
    unit: "ms",
    value: "61",
  },
  {
    category: "Sleep",
    metricKey: "rem-sleep-minutes",
    name: "REM",
    summary: "Time spent in rapid-eye-movement sleep each night, where the brain fires almost as actively as when awake to consolidate memory, process emotion, and rehearse learned patterns.",
    unit: "minutes",
    value: "132",
  },
  {
    category: "Cardiovascular",
    metricKey: "resting-heart-rate",
    name: "RHR",
    summary: "How many times the heart beats per minute at full rest, where a lower count usually means the heart pumps more blood per beat and needs fewer contractions to do the same job.",
    unit: "bpm",
    value: "54",
  },
  {
    category: "Respiratory",
    metricKey: "blood-oxygen-spo2",
    name: "SpO₂",
    summary: "Percentage of hemoglobin carrying oxygen in the blood, where a consistently high reading means the lungs are loading red blood cells efficiently and tissue is getting the oxygen it needs.",
    unit: "%",
    value: "97.3",
  },
] as const;

export const BIOMARKER_STUDY_GROUPS: readonly BiomarkerStudyGroup[] = [
  {
    id: "blood-sugar",
    label: "Blood sugar",
    results: [
      result("c-peptide", "C-peptide", "ng/mL"),
      result("glucose", "Glucose", "mg/dL"),
      result("hba1c", "HbA1c", "%"),
      result("insulin", "Insulin", "mIU/L"),
    ],
  },
  {
    id: "heart-lipids",
    label: "Heart & lipids",
    results: [
      result("homocysteine", "Homocysteine", "umol/L"),
      result("ldl-large-particles", "LDL large particles", "nmol/L"),
      result("ldl-medium-particles", "LDL medium particles", "nmol/L"),
      result("ldl-particle-number", "LDL particle number", "nmol/L"),
      result("ldl-peak-size", "LDL peak size", "Angstrom"),
      result("ldl-small-particles", "LDL small particles", "nmol/L"),
      result("ldl-c", "LDL-C", "mg/dL"),
      result("total-cholesterol", "Total cholesterol", "mmol/L"),
      result("apob", "ApoB", "mg/dL"),
      result("cholesterol-hdl-ratio", "Cholesterol/HDL ratio", "ratio"),
      result("hdl-c", "HDL-C", "mg/dL"),
      result("ldl-pattern", "LDL pattern", null),
      result("lipoprotein-a", "Lipoprotein(a)", "nmol/L"),
      result("non-hdl-cholesterol", "Non-HDL cholesterol", "mmol/L"),
      result("triglycerides", "Triglycerides", "mg/dL"),
      result("vldl-cholesterol-calculated", "Calculated VLDL cholesterol", "mg/dL"),
      result("ldl-calculated", "LDL Calculated", "mg/dL"),
      result("ldl-chol-calc-nih", "LDL CHOL CALC (NIH)", "mg/dL"),
      result("poc-troponin-i", "POC Troponin I", "ng/mL"),
    ],
  },
  {
    id: "kidneys",
    label: "Kidneys",
    results: [
      result("creatinine", "Creatinine", "mg/dL"),
      result("egfr-ckd-epi", "eGFR (CKD-EPI)", "mL/min/1.73m^2"),
      result("blood-urea-nitrogen", "Blood urea nitrogen", "mg/dL"),
      result("egfr", "eGFR", "mL/min/1.73m^2"),
      result("uric-acid", "Uric Acid", "mmol/L"),
      result("urine-protein", "Urine protein", null),
      result("bun-creatinine-ratio", "BUN/Creatinine Ratio", null),
      result("gfr-mdrd-af-amer", "GFR MDRD Af Amer", "mL/min/1.73"),
      result("gfr-mdrd-non-af-amer", "GFR MDRD Non Af Amer", "mL/min/1.73"),
      result("urine-albumin-random-without-creatinine", "Urine albumin random without creatinine", "mg/dL"),
    ],
  },
  {
    id: "liver",
    label: "Liver",
    results: [
      result("albumin", "Albumin", "g/dL"),
      result("albumin-globulin-ratio", "Albumin/Globulin Ratio", "ratio"),
      result("alkaline-phosphatase", "Alkaline phosphatase", "U/L"),
      result("alt", "ALT", "U/L"),
      result("ast", "AST", "U/L"),
      result("fib4", "FIB-4", "score"),
      result("ggt", "GGT", "U/L"),
      result("total-globulin", "Globulin", "g/L"),
      result("total-bilirubin", "Total bilirubin", "umol/L"),
      result("total-protein", "Total Protein", "g/L"),
    ],
  },
  {
    id: "thyroid",
    label: "Thyroid",
    results: [
      result("free-t3", "Free T3", "pg/mL"),
      result("free-t4", "Free T4", "ng/dL"),
      result("thyroglobulin-antibodies", "Thyroglobulin Antibodies", null),
      result("thyroid-peroxidase-antibodies", "Thyroid Peroxidase Antibodies", "IU/mL"),
      result("thyroid-stimulating-hormone", "Thyroid-stimulating hormone", "mIU/L"),
    ],
  },
  {
    id: "blood",
    label: "Blood",
    results: [
      result("absolute-neutrophils", "Neutrophils, absolute", "x10^9/L"),
      result("white-blood-cell-count", "White blood cells", "x10^9/L"),
      result("basophil-percentage", "Basophils", "%"),
      result("absolute-basophils", "Basophils, absolute", "x10^9/L"),
      result("eosinophil-percentage", "Eosinophils", "%", "review"),
      result("absolute-eosinophils", "Eosinophils, absolute", "x10^9/L"),
      result("hematocrit", "Hematocrit", "%"),
      result("hemoglobin", "Hemoglobin", "g/dL"),
      result("lymphocyte-percentage", "Lymphocytes", "%", "review"),
      result("absolute-lymphocytes", "Lymphocytes, absolute", "x10^9/L"),
      result("mean-corpuscular-hemoglobin", "Mean corpuscular hemoglobin", "pg"),
      result("mean-corpuscular-hemoglobin-concentration", "Mean corpuscular hemoglobin concentration", "g/dL"),
      result("mean-corpuscular-volume", "Mean corpuscular volume", "fL"),
      result("mean-platelet-volume", "Mean Platelet Volume", "fL"),
      result("monocyte-percentage", "Monocytes", "%"),
      result("absolute-monocytes", "Monocytes, absolute", "x10^9/L"),
      result("neutrophil-percentage", "Neutrophils", "%"),
      result("platelet-count", "Platelets", "x10^9/L"),
      result("red-blood-cell-count", "Red blood cells", "x10^12/L"),
      result("red-cell-distribution-width", "Red cell distribution width", "%"),
      result("immature-granulocyte-percentage", "Immature granulocytes", "%"),
      result("absolute-immature-granulocytes", "Immature granulocytes, absolute", "x10E3/uL", "review"),
      result("mean-platelet-volume", "MPV", "fL"),
    ],
  },
  {
    id: "hormones",
    label: "Hormones",
    results: [
      result("free-testosterone", "Free testosterone", "pg/mL"),
      result("cortisol", "Cortisol", "mcg/dL"),
      result("dhea-sulfate", "DHEA sulfate", "mcg/dL"),
      result("sex-hormone-binding-globulin", "Sex Hormone Binding Globulin", "nmol/L"),
      result("total-testosterone", "Total testosterone", "ng/dL"),
      result("estradiol", "Estradiol", "pg/mL"),
      result("follicle-stimulating-hormone", "Follicle Stimulating Hormone", "mIU/mL"),
      result("luteinizing-hormone", "Luteinizing Hormone", "mIU/mL"),
      result("prolactin", "Prolactin", "ng/mL"),
    ],
  },
  {
    id: "nutrients-fatty-acids",
    label: "Nutrients & fatty acids",
    results: [
      result("omega-3-total-omegacheck", "Omega-3 Total / OmegaCheck", "% by wt"),
      result("arachidonic-acid", "Arachidonic Acid", "% by wt"),
      result("arachidonic-acid-epa-ratio", "Arachidonic Acid/EPA Ratio", null),
      result("dha", "DHA", "% by wt"),
      result("dpa", "DPA", "% by wt"),
      result("epa", "EPA", "% by wt"),
      result("ferritin", "Ferritin", "ng/mL"),
      result("iron", "Iron", "mcg/dL"),
      result("iron-saturation", "Iron saturation", "% (calc)"),
      result("linoleic-acid", "Linoleic Acid", "% by wt"),
      result("magnesium-rbc", "Magnesium RBC", "mg/dL"),
      result("methylmalonic-acid", "Methylmalonic Acid", "nmol/L"),
      result("omega-6-3-ratio", "Omega 6/3 Ratio", null),
      result("total-iron-binding-capacity", "Total Iron Binding Capacity", "mcg/dL (calc)"),
      result("vitamin-d", "Vitamin D", "ng/mL"),
      result("zinc", "Zinc", "mcg/dL"),
      result("omega-6-total", "Omega-6 total", "% by wt"),
      result("omegacheck-total", "OmegaCheck total", "% by wt"),
    ],
  },
  {
    id: "inflammation-immune",
    label: "Inflammation & immune",
    results: [
      result("ana-screen", "ANA screen", null),
      result("hs-crp", "hs-CRP", "mg/L"),
      result("rheumatoid-factor", "Rheumatoid Factor", null),
    ],
  },
  {
    id: "electrolytes",
    label: "Electrolytes",
    results: [
      result("adjusted-calcium", "Adjusted Calcium", "mmol/L"),
      result("calcium", "Calcium", "mmol/L"),
      result("carbon-dioxide", "Carbon Dioxide", "mmol/L"),
      result("chloride", "Chloride", "mmol/L"),
      result("phosphate", "Phosphate", "mmol/L"),
      result("potassium", "Potassium", "mmol/L"),
      result("sodium", "Sodium", "mmol/L"),
      result("anion-gap", "Anion Gap", null, "reported"),
      result("carbon-dioxide", "CO2", "mmol/L"),
    ],
  },
  {
    id: "muscle-tissue",
    label: "Muscle & tissue",
    results: [
      result("creatine-kinase", "Creatine Kinase", "U/L"),
      result("ldh", "LDH", "U/L"),
    ],
  },
  {
    id: "environmental-exposure",
    label: "Environmental exposure",
    results: [
      result("lead", "Lead", "mcg/dL"),
      result("mercury", "Mercury", "mcg/L"),
    ],
  },
  {
    id: "prostate-health",
    label: "Prostate health",
    results: [
      result("psa-free", "PSA free", "ng/mL"),
      result("psa-percent-free", "PSA percent free", "% (calc)"),
      result("psa-total", "PSA total", "ng/mL"),
    ],
  },
] as const;

function result(
  metricKey: string,
  name: string,
  unit: string | null,
  statusOverride?: BiomarkerStudyStatus,
): BiomarkerStudyResult {
  const seed = syntheticSeed(metricKey);
  const statusBucket = seed % 8;
  const generatedStatus: BiomarkerStudyStatus = statusBucket === 0
    ? "review"
    : statusBucket === 1
      ? "reported"
      : "in-range";
  const status = statusOverride ?? generatedStatus;
  const statusLabel = status === "review"
    ? seed % 2 === 0 ? "Above range" : "Below range"
    : status === "reported" ? "Reported" : "In range";

  return {
    metricKey,
    name,
    status,
    statusLabel,
    unit,
    value: syntheticValue(metricKey, unit, seed),
  };
}

function syntheticSeed(metricKey: string): number {
  let seed = 0;
  for (const character of metricKey) {
    seed = ((seed * 31) + (character.codePointAt(0) ?? 0)) % 10_007;
  }
  return seed;
}

function syntheticValue(metricKey: string, unit: string | null, seed: number): string {
  const qualitativeValues: Readonly<Record<string, string>> = {
    "ana-screen": "Negative",
    "ldl-pattern": "A",
    "rheumatoid-factor": "<10",
    "thyroglobulin-antibodies": "<1",
    "urine-protein": "Negative",
  };
  const qualitativeValue = qualitativeValues[metricKey];
  if (qualitativeValue) {
    return qualitativeValue;
  }

  if (!unit || unit === "ratio" || unit === "score") {
    return (1 + ((seed % 90) / 10)).toFixed(1);
  }
  if (unit.includes("% by wt")) {
    return (0.5 + ((seed % 410) / 10)).toFixed(1);
  }
  if (unit.includes("%")) {
    return String(10 + (seed % 81));
  }
  if (unit.includes("mL/min")) {
    return String(65 + (seed % 56));
  }
  if (unit.includes("x10^9/L") || unit.includes("x10E3/uL")) {
    return (0.1 + ((seed % 180) / 10)).toFixed(1);
  }
  if (unit.includes("x10^12/L")) {
    return (3.8 + ((seed % 220) / 100)).toFixed(2);
  }
  if (unit === "g/dL") {
    return (3.5 + ((seed % 150) / 10)).toFixed(1);
  }
  if (unit === "mmol/L") {
    return (1.5 + ((seed % 85) / 10)).toFixed(1);
  }
  if (unit === "mg/dL") {
    return (5 + (seed % 145)).toFixed(seed % 3 === 0 ? 1 : 0);
  }

  return String(1 + (seed % 360));
}
