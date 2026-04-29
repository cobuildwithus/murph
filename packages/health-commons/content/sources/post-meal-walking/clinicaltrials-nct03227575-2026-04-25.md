---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03227575-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct03227575-2026-04-25
title: Effects of Brisk Walking and Regular Intensity Exercise in Type 2 Diabetes
summary: Withdrawn registry for a 4-week post-meal walking protocol in sedentary obese young adults; actual enrollment was 0 and no outcomes were posted.
status: draft
quality: usable
aliases:
- NCT03227575
- Post-Meal Walking Group
- Plymouth State post-meal walking registry
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
  title: Effects of Brisk Walking and Regular Intensity Exercise Interventions on Glycemic Control
  authors: Plymouth State University
  year: 2017
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Effects of Brisk Walking and Regular Intensity Exercise Interventions on Glycemic Control. NCT03227575. First posted 2017-07-24; last updated 2024-11-12.
  url: https://clinicaltrials.gov/study/NCT03227575
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT03227575
    url: https://clinicaltrials.gov/study/NCT03227575
  canonicalUrl: https://clinicaltrials.gov/study/NCT03227575
  identityAliases:
  - NCT03227575
  - Post-Meal Walking Group
  - Plymouth State post-meal walking registry
researchEvidence:
  designKind: other
  designLabel: Withdrawn randomized pilot trial registry record
  populationLabel: Sedentary obese young adults aged 18–39 years, free of known cardiovascular disease, diabetes, chronic kidney disease, and cancer.
  durationLabel: 4-week intervention planned; registry withdrawn with no enrolled participants.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct03227575-2026-04-25
  notes:
  - 'Overall status WITHDRAWN; reason: original PI changed institutions and COVID.'
  - Actual enrollment 0.
  - Direct protocol schedule but no outcomes.
  - Population was young sedentary obese adults at risk for metabolic syndrome, not adults with diagnosed T2D.
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: It preserves an implementation-ready direct protocol design—15 minutes after each meal, at least 4 days/week—while showing that the registry cannot support outcome claims.
potentialMurphEndpoints:
- CGM glucose
- OGTT glucose and insulin
- activity monitor adherence
- ambulatory blood pressure
protocolTakeaway: Useful for dose/adherence design language only; no efficacy claim because the trial was withdrawn with no participants.
murphTakeaway: A feasible source-derived cadence is 15 minutes after meals, but any protocol claim must come from completed studies rather than this withdrawn record.
studyDesign: rct
modality: 15-minute brisk post-meal walking after breakfast, lunch, and dinner
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** The registry planned brisk 15-minute walks after breakfast, lunch, and dinner at least four times per week for 4 weeks, but the trial was withdrawn with actual enrollment 0.

**Why it matters:** It preserves an implementation-ready direct protocol design—15 minutes after each meal, at least 4 days/week—while showing that the registry cannot support outcome claims.

**Potential experiment signals:** CGM glucose, OGTT glucose and insulin, activity monitor adherence, ambulatory blood pressure.

**Protocol takeaway:** Useful for dose/adherence design language only; no efficacy claim because the trial was withdrawn with no participants.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Sedentary young adults, age 18–39, BMI ≥30, free of known cardiovascular disease, diabetes, chronic kidney disease, and cancer.

- **Participant count:** 0 actual participants.

- **Intervention/exposure:** Post-Meal Walking Group: after a 30-minute digestion period, walk after breakfast, lunch, and dinner at least four times per week, 15 minutes brisk pace, totaling 180 minutes/week; Garmin VivoFit used for activity monitoring.

- **Comparator/control:** Traditional exercise group with supervised aerobic/light resistance exercise three times per week; case-control no-intervention group for ambulatory blood pressure context.

- **Duration/follow-up:** 4 weeks, with baseline and follow-up measurements separated by about 28–32 days.

- **Endpoints:** OGTT blood glucose and serum insulin; CGM glucose; daily steps/activity; ambulatory 24-hour blood pressure.

- **Effect estimates or direction:** No effect estimate; no results posted; actual enrollment 0.

- **Adverse events/safety notes:** Exercise exclusions and clinical measurements were planned; no adverse events were posted.

- **Limitations:** Withdrawn; no participants/results; young obese but non-diabetic population; registry-only; not free-living efficacy evidence.

- **Population mismatch:** Direct meal-after-walking schedule, but young sedentary obese non-diabetic population and no enrollment.

- **Directness to Walking After Every Meal:** direct_protocol

- **Artifact candidates and rights:** ClinicalTrials.gov external registry record; keep source-page metadata only.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct03227575-2026-04-25:001`
