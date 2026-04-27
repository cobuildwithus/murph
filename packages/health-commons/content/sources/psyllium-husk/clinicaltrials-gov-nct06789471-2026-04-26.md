---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-gov-nct06789471-2026-04-26"
slug: "sources/psyllium-husk/clinicaltrials-gov-nct06789471-2026-04-26"
title: "Effects of Psyllium Seed on Body Weight and Metabolic Syndrome Indicators in Patients With Schizophrenia"
summary: "ClinicalTrials.gov registry record for 10 g/day psyllium husk in schizophrenia patients with metabolic-risk indicators and lipid secondary endpoints."
status: "draft"
quality: "usable"
aliases:
  - "NCT06789471"
  - "Psyllium seed schizophrenia metabolic syndrome trial"
categories:
  - "psyllium-husk"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "web_page"
  title: "Effects of Psyllium Seed on Body Weight and Metabolic Syndrome Indicators in Patients With Schizophrenia"
  authors: "Registry sponsor/record holder: Ru-Shin Zhang"
  year: 2024
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Effects of Psyllium Seed on Body Weight and Metabolic Syndrome Indicators in Patients With Schizophrenia. NCT06789471. Registry record. Extracted 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT06789471"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT06789471"
    titleHash: "526c29e5929ebfa053d75a445bf8f19ce3e05aaffea14b03076b2e92d2ce7ea5"
    url: "https://clinicaltrials.gov/study/NCT06789471"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06789471"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Randomized single-blind supportive-care controlled registry record"
  participantCount: 24
  participantCountKind: "reported"
  populationLabel: "Adults age 20–65 years with schizophrenia, BMI at least 24 or metabolic syndrome indicators, and HbA1c 5.7–6.4%."
  durationLabel: "12 weeks."
  aggregateRole: "context"
  cohortKey: "nct06789471"
  notes:
    - "Directness to protocol: direct_protocol."
    - "Population mismatch: Psychiatric/metabolic-risk population with HbA1c constraints, not general adults with elevated LDL-C."
    - "Small registered sample."
    - "Schizophrenia and metabolic-syndrome-risk population."
    - "Standard-care comparator rather than placebo."
    - "No registry-extracted results."
sourceKind: "trial_registry"
evidenceBucket: "Registries and unpublished protocols"
directness: "direct_protocol"
whyItMatters: "Provides clear dose and pre-meal timing with lipid endpoints, but the psychiatric/metabolic-syndrome population and non-placebo supportive-care comparator limit transfer."
potentialMurphEndpoints:
  - "body weight"
  - "waist circumference"
  - "BMI"
  - "fasting glucose"
  - "TC"
  - "TG"
  - "HDL-C"
  - "LDL-C"
  - "HbA1c"
protocolTakeaway: "Use as context for timing and metabolic endpoint breadth only; do not generalize to general cholesterol self-experimenters."
murphTakeaway: "Direct psyllium dosing record, but population and comparator mismatch keep it context-only."
studyDesign: "Randomized, parallel, single-blind interventional trial"
modality: "psyllium husk / Plantago ovata fiber intervention or registry context"
claimUse: "context-only"
limitations:
  - "Small registered sample."
  - "Schizophrenia and metabolic-syndrome-risk population."
  - "Standard-care comparator rather than placebo."
  - "No registry-extracted results."
populationMismatch: "Psychiatric/metabolic-risk population with HbA1c constraints, not general adults with elevated LDL-C."
interventionOrExposure: "10 g/day psyllium husk divided into two doses, approximately 1 hour before meals, for 12 weeks."
comparatorOrControl: "Standard/supportive care rather than placebo in the extracted registry record."
durationOrFollowUp: "12 weeks."
endpoints: "Primary body weight, waist circumference, and BMI; secondary metabolic syndrome indicators including fasting glucose, total cholesterol, triglycerides, HDL-C, LDL-C, and HbA1c."
effectEstimatesOrDirection: "No registry-extracted effect estimates."
adverseEventsOrSafetyNotes: "Exclusions included intestinal obstruction, choking risk, allergy/asthma, cardiovascular disease, cancer, and use of lipid-lowering or other metabolic medications; no adverse-event results extracted."
artifactCandidates:
  - "art-clinicaltrials-gov-nct06789471-2026-04-26"
sourceFindings:
  -
    findingId: "finding:clinicaltrials-gov-nct06789471-schizophrenia-psyllium-lipid-endpoints"
    sourceKey: "source_artifact:clinicaltrials-gov-nct06789471-2026-04-26"
    extractedFromArtifactId: "art-clinicaltrials-gov-nct06789471-2026-04-26"
    findingKind: "context"
    population: "Adults age 20–65 years with schizophrenia, BMI at least 24 or metabolic syndrome indicators, and HbA1c 5.7–6.4%."
    exposure: "10 g/day psyllium husk divided into two doses, approximately 1 hour before meals, for 12 weeks."
    outcome: "Primary body weight, waist circumference, and BMI; secondary metabolic syndrome indicators including fasting glucose, total cholesterol, triglycerides, HDL-C, LDL-C, and HbA1c."
    summary: "Registry protocol used 10 g/day psyllium husk split into two pre-meal doses for 12 weeks in adults with schizophrenia and metabolic-risk indicators, with LDL-C and other metabolic markers as secondary outcomes and no extracted results."
    evidenceUse:
      - "context"
      - "measurement"
      - "adjacent_variant"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Registries and unpublished protocols**.

**Findings:** Registry protocol used 10 g/day psyllium husk split into two pre-meal doses for 12 weeks in adults with schizophrenia and metabolic-risk indicators, with LDL-C and other metabolic markers as secondary outcomes and no extracted results.

**Why it matters:** Provides clear dose and pre-meal timing with lipid endpoints, but the psychiatric/metabolic-syndrome population and non-placebo supportive-care comparator limit transfer.

**Potential experiment signals:** body weight, waist circumference, BMI, fasting glucose, TC, TG, HDL-C, LDL-C, HbA1c.

**Protocol takeaway:** Use as context for timing and metabolic endpoint breadth only; do not generalize to general cholesterol self-experimenters.

**Claim use:** `context-only`.

**Directness:** `direct_protocol`.

**Population mismatch:** Psychiatric/metabolic-risk population with HbA1c constraints, not general adults with elevated LDL-C.

**Limitations:** Small registered sample.; Schizophrenia and metabolic-syndrome-risk population.; Standard-care comparator rather than placebo.; No registry-extracted results.

**Safety notes:** Exclusions included intestinal obstruction, choking risk, allergy/asthma, cardiovascular disease, cancer, and use of lipid-lowering or other metabolic medications; no adverse-event results extracted.
