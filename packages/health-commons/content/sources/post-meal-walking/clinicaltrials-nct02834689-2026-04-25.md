---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02834689-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct02834689-2026-04-25
title: Exercise Physical Activity and Diabetes Glucose Monitoring Protocol
summary: Completed registry for a 79-participant type 2 diabetes crossover study testing a standardized 50-minute treadmill walking bout versus seated control with 24-hour CGM endpoints.
status: draft
quality: usable
aliases:
- NCT02834689
- E-PAraDiGM
- The Canadian E-PAraDiGM Protocol
categories:
- post-meal-walking
relations:
-
  type: related_protocol
  target: protocol_variant:post-meal-walking/walking-after-every-meal
-
  type: parent_family
  target: experiment_family:post-meal-walking
source:
  kind: other
  title: The Canadian E-PAraDiGM (Exercise Physical Activity and Diabetes Glucose Monitoring) Protocol
  authors: University of British Columbia; Jonathan Little; E-PAraDiGM collaborators
  year: 2016
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. The Canadian E-PAraDiGM (Exercise Physical Activity and Diabetes Glucose Monitoring) Protocol. NCT02834689. First posted 2016-07-15; last updated 2019-10-03.
  url: https://clinicaltrials.gov/study/NCT02834689
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT02834689
    url: https://clinicaltrials.gov/study/NCT02834689
  canonicalUrl: https://clinicaltrials.gov/study/NCT02834689
  identityAliases:
  - NCT02834689
  - E-PAraDiGM
  - The Canadian E-PAraDiGM Protocol
researchEvidence:
  designKind: other
  designLabel: Completed randomized crossover trial registry record
  participantCount: 79
  participantCountKind: reported
  populationLabel: Adults aged 30–90 years with type 2 diabetes for more than 6 months, HbA1c <9.0%, not using insulin or corticosteroids, and able to walk 50 minutes.
  durationLabel: 24-hour CGM endpoint window after walking or seated control; study completed in 2017.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct02834689-2026-04-25
  notes:
  - 'Adjacent variant: standardized acute walking bout, not walking after every meal.'
  - Registry lists a derived publication titled Minimal effect of walking before dinner on glycemic responses in type 2 diabetes.
  - ClinicalTrials.gov record itself has no posted results.
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: This registry helps map trial provenance and CGM endpoint choices for acute walking in type 2 diabetes, while preserving the adjacent-variant boundary.
potentialMurphEndpoints:
- 24-hour mean glucose by CGM
- post-breakfast/lunch/dinner 2-hour glucose iAUC
- glycemic variability
- time above 10 mmol/L
protocolTakeaway: Use as trial-provenance and endpoint context only; do not treat a single standardized walking bout as evidence for walking after every meal.
murphTakeaway: A Murph experiment should distinguish meal-level glucose windows from 24-hour CGM effects and define whether the walk is after each meal or a single timed bout.
studyDesign: crossover
modality: standardized treadmill walking bout
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** The registry enrolled 79 adults with type 2 diabetes for 50 minutes of treadmill walking at 3.5 METs versus 50 minutes seated control, measuring 24-hour CGM and post-meal iAUC endpoints; no results were posted in the registry.

**Why it matters:** This registry helps map trial provenance and CGM endpoint choices for acute walking in type 2 diabetes, while preserving the adjacent-variant boundary.

**Potential experiment signals:** 24-hour mean glucose by CGM, post-breakfast/lunch/dinner 2-hour glucose iAUC, glycemic variability, time above 10 mmol/L.

**Protocol takeaway:** Use as trial-provenance and endpoint context only; do not treat a single standardized walking bout as evidence for walking after every meal.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Adults with type 2 diabetes for >6 months, age 30–90, HbA1c <9.0%, no insulin/corticosteroids, no recent medication/body-weight changes, and no contraindication to treadmill walking.

- **Participant count:** 79 actual participants in the ClinicalTrials.gov registry.

- **Intervention/exposure:** Walking on a treadmill at 3.5 METs for 50 minutes.

- **Comparator/control:** Seated control for 50 minutes.

- **Duration/follow-up:** CGM outcomes assessed over 24 hours after the walking or seated control condition.

- **Endpoints:** Mean 24-hour glucose; MAGE; glucose SD; 2-hour post-dinner, post-lunch, and post-breakfast glucose iAUC; time above 10 mmol/L.

- **Effect estimates or direction:** No registry-posted effect estimate. The registry lists a derived publication, but the source page is maintained as registry/context evidence.

- **Adverse events/safety notes:** Exclusions included exercise contraindications, cardiovascular history, insulin use, and prior hypoglycemia during activity or sleep.

- **Limitations:** Acute standardized bout; not post-meal-walking-after-every-meal; registry-only result extraction; medication-restricted T2D population.

- **Population mismatch:** T2D population is relevant, but the intervention timing/frequency differs from Walking After Every Meal.

- **Directness to Walking After Every Meal:** adjacent_variant

- **Artifact candidates and rights:** ClinicalTrials.gov registry metadata only; no PDF artifact should be vendored.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct02834689-2026-04-25:001`
