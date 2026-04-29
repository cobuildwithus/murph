---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-nct02603276-2026-04-26"
slug: "sources/red-yeast-rice/clinicaltrials-nct02603276-2026-04-26"
title: "ClinicalTrials.gov NCT02603276: phytosterols, red yeast rice, and combination"
summary: "NCT02603276 is a registry record for a randomized parallel trial comparing plant sterols, red yeast rice, and their combination in adults with moderate hypercholesterolemia. It is an adjacent trial registry and evidence watchlist item; no outcome results were extracted here."
status: "draft"
quality: "usable"
aliases:
  - "NCT02603276"
  - "Lipid-lowering Effect of Phytosterols, Red Yeast Rice and Their Combination"
categories:
  - "red-yeast-rice"
  - "lipid-measurement"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "Lipid-lowering Effect of Phytosterols, Red Yeast Rice and Their Combination"
  authors: "University of Bologna"
  year: 2026
  journal: "ClinicalTrials.gov"
  citation: "University of Bologna. Lipid-lowering Effect of Phytosterols, Red Yeast Rice and Their Combination. ClinicalTrials.gov. 2026. Registry:NCT02603276."
  url: "https://clinicaltrials.gov/study/NCT02603276"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT02603276"
    titleHash: "066a9e7ce33c39fdc2411b99d7da0e71e3034037d2fcbeb1caf23bf86dff66c3"
    url: "https://clinicaltrials.gov/study/NCT02603276"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT02603276"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Randomized parallel trial registry record"
  populationLabel: "Adults aged 18 to 70 years with moderate hypercholesterolemia in primary prevention."
  durationLabel: "8 weeks"
  aggregateRole: "context"
  cohortKey: "clinicaltrials-nct02603276-2026-04-26"
  notes:
    - "Comparator/control: Parallel active arms: plant sterols alone, red yeast rice alone, and combination; no placebo arm identified in the registry text extracted here."
    - "Effect estimates/direction: No posted trial results or effect estimates extracted in this batch."
    - "Safety notes: Registry rationale notes that full-dosed red yeast rice can induce myalgias or myopathies, and the study lists treatment-related adverse events as a secondary outcome; no observed adverse-event results were extracted."
    - "Population mismatch: Moderate hypercholesterolemia primary-prevention adults aged 18-70 may not match all red yeast rice users, and the low-dose monacolin K formulation is an adjacent variant."
    - "Participant count is estimated enrollment from the registry-derived record, not analyzed sample size."
  participantCount: 60
  participantCountKind: "approximate"
evidenceBucket: "Adjacent trial registry and future evidence watchlist"
whyItMatters: "Registry record for the three-arm PhytoRed trial with a separable RYR-only arm."
potentialMurphEndpoints:
  - "LDL-C"
  - "non-HDL-C"
  - "total cholesterol"
  - "triglycerides"
  - "HDL-C"
  - "treatment-related adverse events"
protocolTakeaway: "Track as a future-evidence/watchlist source only unless results become available; do not use the registry record as efficacy evidence."
murphTakeaway: "Adjacent RYR formulation trial registry with useful endpoint and dose details, but no extractable efficacy result."
studyDesign: "rct"
modality: "trial registry and adjacent red yeast rice variant"
claimUse: "context-only"
directnessToProtocol: "adjacent_variant"
interventionOrExposure: "Plant sterols, red yeast rice 200 mg containing 5 mg monacolin K per day, or their combination for 8 weeks."
comparatorOrControl: "Parallel active arms: plant sterols alone, red yeast rice alone, and combination; no placebo arm identified in the registry text extracted here."
effectEstimatesOrDirection: "No posted trial results or effect estimates extracted in this batch."
adverseEventsOrSafetyNotes: "Registry rationale notes that full-dosed red yeast rice can induce myalgias or myopathies, and the study lists treatment-related adverse events as a secondary outcome; no observed adverse-event results were extracted."
limitations:
  - "Registry record only; no extracted results."
  - "Estimated enrollment 60 and active-arm design without a placebo arm in extracted text."
  - "Low-dose red yeast rice with phytosterol comparison/combination may not match typical commercial red yeast rice protocols."
  - "Excluded prior red yeast rice intolerance and prior cardiovascular disease, limiting safety generalizability."
populationMismatch: "Moderate hypercholesterolemia primary-prevention adults aged 18-70 may not match all red yeast rice users, and the low-dose monacolin K formulation is an adjacent variant."
sourceFindings:

  -
    findingId: "finding:clinicaltrials-nct02603276-2026-04-26-registry-ryr-phytosterol-arms"
    sourceKey: "source_artifact:clinicaltrials-nct02603276-2026-04-26"
    findingKind: "context"
    population: "Adults aged 18 to 70 years with moderate hypercholesterolemia in primary prevention."
    exposure: "Plant sterols, red yeast rice 200 mg with 5 mg monacolin K daily, and their combination."
    outcome: "LDL-C reduction primary endpoint and non-HDL-C plus adverse events as secondary outcomes."
    summary: "The registry describes an 8-week randomized parallel trial with plant sterol, red yeast rice, and combination arms, enrolling an estimated 60 adults with moderate hypercholesterolemia. No efficacy result was extracted."
    evidenceUse:
      - "adjacent_variant"
      - "context"
  -
    findingId: "finding:clinicaltrials-nct02603276-2026-04-26-registry-ryr-myalgia-myopathy-safety-note"
    sourceKey: "source_artifact:clinicaltrials-nct02603276-2026-04-26"
    findingKind: "safety"
    population: "Adults with moderate hypercholesterolemia eligible for the registered trial."
    exposure: "Red yeast rice formulation containing monacolin K."
    outcome: "Myalgia/myopathy concern and treatment-related adverse event monitoring."
    summary: "The registry rationale notes myalgia/myopathy concerns with full-dosed red yeast rice and includes treatment-related adverse events as a secondary outcome, but no observed adverse-event rates were extracted."
    evidenceUse:
      - "safety"
      - "adjacent_variant"
murphV1Priority: "Low"
pdfRightsStatus: "open_access"
---
This source is included for **Adjacent trial registry and future evidence watchlist**.

**Findings:** The registry describes an 8-week randomized parallel trial with plant sterol, red yeast rice, and combination arms, enrolling an estimated 60 adults with moderate hypercholesterolemia. No efficacy result was extracted. The registry rationale notes myalgia/myopathy concerns with full-dosed red yeast rice and includes treatment-related adverse events as a secondary outcome, but no observed adverse-event rates were extracted.

**Why it matters:** Registry record for the three-arm PhytoRed trial with a separable RYR-only arm.

**Potential experiment signals:** LDL-C primary endpoint over 8 weeks.; Non-HDL-C secondary endpoint.; Treatment-related adverse events as a safety signal.; Formulation detail: 5 mg/day monacolin K in RYR arm..

**Protocol takeaway:** Track as a future-evidence/watchlist source only unless results become available; do not use the registry record as efficacy evidence.

**Claim use:** `context-only`.

**Limitations and directness:** Directness is `adjacent_variant`. Registry record only; no extracted results. Estimated enrollment 60 and active-arm design without a placebo arm in extracted text. Low-dose red yeast rice with phytosterol comparison/combination may not match typical commercial red yeast rice protocols. Excluded prior red yeast rice intolerance and prior cardiovascular disease, limiting safety generalizability. Population mismatch: Moderate hypercholesterolemia primary-prevention adults aged 18-70 may not match all red yeast rice users, and the low-dose monacolin K formulation is an adjacent variant.
