---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clevelandclinic-refeeding-syndrome-2022-06-06
slug: sources/prolonged-fasting/clevelandclinic-refeeding-syndrome-2022-06-06
title: 'Refeeding Syndrome: Symptoms, Treatment & Risk Factors'
summary: Cleveland Clinic health-library page describing refeeding syndrome, electrolyte shifts, risk factors, symptoms, treatment, and prevention advice relevant to refeeding boundaries after prolonged fasting.
status: draft
quality: usable
aliases:
  - Cleveland Clinic refeeding syndrome
  - Refeeding syndrome risk factors
categories:
  - prolonged-fasting
relations:
  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
  -
    type: parent_family
    target: experiment_family:prolonged-fasting
source:
  kind: guideline
  title: 'Refeeding Syndrome: Symptoms, Treatment & Risk Factors'
  authors: Cleveland Clinic
  year: 2022
  journal: Cleveland Clinic Health Library
  citation: 'Cleveland Clinic. Refeeding Syndrome: Symptoms, Treatment & Risk Factors. Last updated 2022-06-06. Accessed for batch-011.'
  url: https://my.clevelandclinic.org/health/diseases/23228-refeeding-syndrome
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://my.clevelandclinic.org/health/diseases/23228-refeeding-syndrome
    titleHash: 8ea7660f8b68f10f2fd41024b294990f87a3f7befd9a75608734e8174351e68b
  canonicalUrl: https://my.clevelandclinic.org/health/diseases/23228-refeeding-syndrome
researchEvidence:
  designKind: guideline
  designLabel: Patient-facing clinical safety guidance
  populationLabel: People who have been malnourished, deprived of food, or are at risk during refeeding.
  durationLabel: Refeeding syndrome commonly emerges during the first five days of refeeding after deprivation.
  aggregateRole: context
  cohortKey: cohort:prolonged-fasting-refeeding-syndrome-guideline
evidenceBucket: implementation, hydration, and refeed context
whyItMatters: Refeeding is a key safety boundary for longer fasts and higher-risk participants, especially when electrolyte stores may be depleted.
potentialMurphEndpoints:
  - phosphate
  - magnesium
  - potassium
  - thiamine status
  - blood glucose
  - vital signs
  - fluid retention symptoms
protocolTakeaway: 'Use as safety-only context: a 24–72 hour protocol should include explicit refeeding caution, risk-screening, and medical-supervision boundaries for vulnerable users.'
murphTakeaway: Participants should not treat the end of a fast as risk-free; refeeding symptoms and electrolyte context may matter as much as fasting-day signals.
studyDesign: Clinical safety guidance / health-library review.
modality: Refeeding risk after food deprivation or malnutrition.
claimUse: safety-only
sourceFindings:
  -
    findingId: finding:clevelandclinic-refeeding-syndrome-2022-06-06-electrolyte-shift-risk
    findingKind: safety
    population: People beginning to eat after malnutrition or nutrient deprivation.
    exposure: Rapid refeeding after nutrient deprivation.
    outcome: Electrolyte and fluid/glucose complications.
    summary: The page describes refeeding syndrome as severe shifts related to electrolyte deficiencies when food is reintroduced too quickly, especially involving phosphorus, potassium, and magnesium, with potential effects on muscles, lungs, heart, and brain.
    evidenceUse:
      - safety
    sourceKey: source_artifact:clevelandclinic-refeeding-syndrome-2022-06-06
    extractedFromArtifactId: art_clevelandclinic_refeeding_syndrome_2022_06_06_source_record
  -
    findingId: finding:clevelandclinic-refeeding-syndrome-2022-06-06-monitoring-and-slow-refeed
    findingKind: safety
    population: People at risk of refeeding syndrome.
    exposure: Medical refeeding process.
    outcome: Monitoring and treatment approach.
    summary: The page recommends pre-refeeding blood tests, electrolyte replacement before carbohydrate metabolism is stressed, continued daily electrolyte monitoring, and slowing refeeding or reducing carbohydrate delivery if symptoms occur.
    evidenceUse:
      - safety
      - context
    sourceKey: source_artifact:clevelandclinic-refeeding-syndrome-2022-06-06
    extractedFromArtifactId: art_clevelandclinic_refeeding_syndrome_2022_06_06_source_record
murphV1Priority: High
pdfRightsStatus: unknown
directnessToProtocol: general_guideline
populationMismatch: High-risk malnutrition and prolonged deprivation populations may not match lower-risk healthy adults completing a short fast, but the mechanism is directly relevant to refeeding risk.
limitations:
  - Patient-facing guidance, not a fasting-specific controlled trial and not limited to 24–72 hour fasts.
claimUseBoundary: safety-only
---

This source is included for **implementation, hydration, and refeed context**.

**Findings:**
- `finding:clevelandclinic-refeeding-syndrome-2022-06-06-electrolyte-shift-risk` — The page describes refeeding syndrome as severe shifts related to electrolyte deficiencies when food is reintroduced too quickly, especially involving phosphorus, potassium, and magnesium, with potential effects on muscles, lungs, heart, and brain.
- `finding:clevelandclinic-refeeding-syndrome-2022-06-06-monitoring-and-slow-refeed` — The page recommends pre-refeeding blood tests, electrolyte replacement before carbohydrate metabolism is stressed, continued daily electrolyte monitoring, and slowing refeeding or reducing carbohydrate delivery if symptoms occur.

**Why it matters:** Refeeding is a key safety boundary for longer fasts and higher-risk participants, especially when electrolyte stores may be depleted.

**Potential experiment signals:** phosphate, magnesium, potassium, thiamine status, blood glucose, vital signs, fluid retention symptoms.

**Protocol takeaway:** Use as safety-only context: a 24–72 hour protocol should include explicit refeeding caution, risk-screening, and medical-supervision boundaries for vulnerable users.

**Directness to Prolonged Fasting (24–72 Hours):** `general_guideline`.

**Population mismatch:** High-risk malnutrition and prolonged deprivation populations may not match lower-risk healthy adults completing a short fast, but the mechanism is directly relevant to refeeding risk.

**Limitations:** Patient-facing guidance, not a fasting-specific controlled trial and not limited to 24–72 hour fasts.

**Claim use:** `safety-only`.

**Artifact and rights note:** Source page draft only. PDF rights status: `unknown`. No copyrighted PDF content is included.
