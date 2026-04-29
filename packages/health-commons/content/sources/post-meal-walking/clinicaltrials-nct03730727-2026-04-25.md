---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03730727-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct03730727-2026-04-25
title: Exercise-meal Timing and Postprandial Glucose Control
summary: Completed registry for a 48-participant crossover timing study comparing walking, standing, or circuit exercise immediately before, immediately after, or 30 minutes after a 500-kcal breakfast shake.
status: draft
quality: usable
aliases:
- NCT03730727
- Exercise-meal timing registry
- Immediate post-breakfast activity timing
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
  title: 'Maximizing Postprandial Glycaemic Control: When is the Right Time for Physical Activity'
  authors: University of Birmingham
  year: 2018
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Exercise-meal Timing and Postprandial Glucose Control. NCT03730727. First posted 2018-11-05; last updated 2018-12-11.
  url: https://clinicaltrials.gov/study/NCT03730727
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT03730727
    url: https://clinicaltrials.gov/study/NCT03730727
  canonicalUrl: https://clinicaltrials.gov/study/NCT03730727
  identityAliases:
  - NCT03730727
  - Exercise-meal timing registry
  - Immediate post-breakfast activity timing
researchEvidence:
  designKind: other
  designLabel: Completed randomized crossover timing trial registry record
  participantCount: 48
  participantCountKind: reported
  populationLabel: Generally healthy adults aged 18–65 years with BMI 18–30 kg/m²; diabetes, pregnancy, smoking, and several chronic diseases were excluded.
  durationLabel: 5 consecutive mornings, with a pre-trial visit and 4 experimental trial visits; 2-hour postprandial CGM endpoint window.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct03730727-2026-04-25
  notes:
  - 'Same-mechanism source: timing and activity comparison around a single standardized liquid meal, not walking after every normal meal.'
  - Registry lists a derived publication, but no ClinicalTrials.gov results are posted.
  - Includes non-walking activities, limiting directness.
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: It gives timing and comparator structure for post-meal activity trials while keeping single-meal laboratory timing separate from the free-living every-meal protocol.
potentialMurphEndpoints:
- 2-hour postprandial CGM glucose
- postprandial glucose mean
- postprandial glucose standard deviation
- MAGE
protocolTakeaway: Use as timing/comparator context; do not promote to direct evidence for walking after every meal.
murphTakeaway: Timing windows and meal type matter; a liquid meal laboratory protocol may not generalize to real-world mixed meals.
studyDesign: crossover
modality: meal-timed walking, standing, or circuit exercise
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** The registry tested control, activity immediately before a meal, immediately after a meal, and 30 minutes after a meal in a randomized crossover design; no registry results were posted.

**Why it matters:** It gives timing and comparator structure for post-meal activity trials while keeping single-meal laboratory timing separate from the free-living every-meal protocol.

**Potential experiment signals:** 2-hour postprandial CGM glucose, postprandial glucose mean, postprandial glucose standard deviation, MAGE.

**Protocol takeaway:** Use as timing/comparator context; do not promote to direct evidence for walking after every meal.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Healthy volunteers aged 18–65, BMI 18–30 kg/m²; diabetes, pregnancy, smoking, recent weight change, and exercise contraindications were excluded.

- **Participant count:** 48 actual participants.

- **Intervention/exposure:** Physical activity consisted of one of three assigned activities: 30 minutes standing, 30 minutes walking at self-selected brisk treadmill pace, or 3 sets of circuit exercises. Timing arms were immediately before meal, immediately after meal, or 30 minutes after meal.

- **Comparator/control:** Control condition with a 500-kcal liquid meal and seated period; in the registry arm description, activity occurred after the primary 2-hour postprandial window.

- **Duration/follow-up:** Pre-trial plus four experimental visits over 5 consecutive mornings; CGM postprandial endpoint window was 2 hours.

- **Endpoints:** Postprandial blood glucose concentration by CGM; mean glucose; glucose SD; MAGE over 2 hours after meal ingestion.

- **Effect estimates or direction:** No ClinicalTrials.gov result estimate posted in the registry record.

- **Adverse events/safety notes:** Heart rate and blood pressure were recorded; contraindication to exercise, pregnancy, and several chronic diseases were exclusions.

- **Limitations:** Single standardized liquid breakfast meal; healthy volunteers; includes standing and circuit exercise; no posted registry results; laboratory timing study rather than free-living every-meal behavior.

- **Population mismatch:** Healthy volunteers and acute lab timing; same postprandial glucose mechanism but not a direct repeated walking-after-meals protocol.

- **Directness to Walking After Every Meal:** same_mechanism

- **Artifact candidates and rights:** ClinicalTrials.gov registry metadata only; no copyrighted article/PDF should be vendored.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct03730727-2026-04-25:001`
