---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct06125704-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct06125704-2026-04-25
title: Time to Move in Pregnancy Hyperglycemia
summary: Recruiting pregnancy-hyperglycemia crossover registry comparing 30 minutes of moderate walking or stepping after breakfast versus after dinner, with 11-day CGM, ActiGraph, diet-photo, sleep, mood, and adverse-event tracking.
status: draft
quality: usable
aliases:
- NCT06125704
- Time to Move
- TtM
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
  title: The Time to Move Randomized Crossover Trial
  authors: The University of Tennessee, Knoxville; Samantha Ehrlich; Jill Maples
  year: 2023
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Time to Move in Pregnancy Hyperglycemia. NCT06125704. First posted 2023-11-09; last updated 2025-03-05.
  url: https://clinicaltrials.gov/study/NCT06125704
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT06125704
    url: https://clinicaltrials.gov/study/NCT06125704
  canonicalUrl: https://clinicaltrials.gov/study/NCT06125704
  identityAliases:
  - NCT06125704
  - Time to Move
  - TtM
researchEvidence:
  designKind: other
  designLabel: Recruiting randomized crossover trial registration
  participantCount: 36
  participantCountKind: approximate
  populationLabel: Pregnant individuals aged 18–40 years with gestational diabetes or gestational glucose intolerance at ≥24 weeks; pre-existing type 1/type 2 diabetes and PA-limiting pregnancy indications excluded.
  durationLabel: 11-day free-living study period with assigned no-PA and 30-minute morning/evening walking/stepping days.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct06125704-2026-04-25
  notes:
  - Recruiting registry; no outcome results posted.
  - 'Adjacent variant: breakfast vs dinner timing in pregnancy hyperglycemia, not after every meal.'
  - Uses CGM, ActiGraph, photo-based diet timing, sleep, mood, and adverse-event surveys.
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: It is a fresh free-living registry with strong adherence and timestamped behavior-measurement design, but it is pregnancy-specific and not a completed outcome source.
potentialMurphEndpoints:
- 24-hour CGM glucose
- post-meal AUCs
- ActiGraph adherence
- food-photo timestamps
- sleep and mood
- adverse-event/equipment issue surveys
protocolTakeaway: Use as implementation and endpoint context only; do not use as evidence of benefit until results are available.
murphTakeaway: Wearables, CGM, and meal-photo timestamps are useful for Murph experiments because they align behavior timing with glucose windows.
studyDesign: interventional_trial_registration
modality: 30-minute moderate walking or stepping after breakfast or dinner
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** The registry estimates 36 pregnant participants and compares 30 minutes of moderate walking/stepping after breakfast versus after dinner across an 11-day CGM and ActiGraph protocol; no results are posted.

**Why it matters:** It is a fresh free-living registry with strong adherence and timestamped behavior-measurement design, but it is pregnancy-specific and not a completed outcome source.

**Potential experiment signals:** 24-hour CGM glucose, post-meal AUCs, ActiGraph adherence, food-photo timestamps, sleep and mood, adverse-event/equipment issue surveys.

**Protocol takeaway:** Use as implementation and endpoint context only; do not use as evidence of benefit until results are available.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Pregnant individuals aged 18–40 with GDM or GGI at ≥24 weeks, singleton viable pregnancy, English communication; exclusions include pre-existing diabetes, PA-limiting pregnancy indications, and medications altering insulin resistance.

- **Participant count:** 36 estimated participants in the ClinicalTrials.gov record.

- **Intervention/exposure:** 30 minutes of moderate walking or stepping at about 100 steps/min, either morning between 5–9 a.m. within 30–40 minutes of starting breakfast or late afternoon/evening between 4–8 p.m. within 30–40 minutes of dinner.

- **Comparator/control:** No-exercise days and within-participant morning versus evening timing comparison.

- **Duration/follow-up:** 11-day free-living study period with Dexcom CGM, ActiGraph watch, food photos, recalls, and daily surveys.

- **Endpoints:** CGM glucose outcomes including 24-hour glucose and coefficient of variation, daytime/nighttime glucose, pre-breakfast AUC, and 120-minute post-breakfast/lunch/dinner AUCs; sleep; mood; adverse events and equipment issues.

- **Effect estimates or direction:** No results posted; recruiting registry and protocol companion source.

- **Adverse events/safety notes:** Daily REDCap surveys include adverse events/equipment issues; PA-limiting pregnancy indications excluded.

- **Limitations:** Recruiting/no results; pregnancy hyperglycemia population; walking or stepping only around breakfast/dinner, not every meal; estimated enrollment.

- **Population mismatch:** Pregnancy hyperglycemia and time-of-day comparison; adjacent to but not the Walking After Every Meal protocol.

- **Directness to Walking After Every Meal:** adjacent_variant

- **Artifact candidates and rights:** Registry metadata only; companion protocol article may be open access, but no PDFs should be vendored without rights review.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct06125704-2026-04-25:001`
