---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-s12966-024-01693-5
slug: sources/post-meal-walking/doi-10.1186-s12966-024-01693-5
title: 'Diet, physical activity, and sleep in relation to postprandial glucose responses under free-living conditions: an intensive longitudinal observational study'
summary: Free-living CGM and accelerometry data linked more post-meal activity with lower 2-hour glucose excursions, but the study was observational and not a prescribed walking protocol.
status: draft
quality: usable
aliases:
- doi:10.1186/s12966-024-01693-5
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
  kind: journal_article
  title: 'Diet, physical activity, and sleep in relation to postprandial glucose responses under free-living conditions: an intensive longitudinal observational study'
  authors: Jiali Yao; Victoria K. Brugger; Sarah M. Edney; E-Shyong Tai; Xueling Sim; Falk Müller-Riemenschneider; Rob M. van Dam
  year: 2024
  journal: International Journal of Behavioral Nutrition and Physical Activity
  citation: 'Jiali Yao; Victoria K. Brugger; Sarah M. Edney; E-Shyong Tai; Xueling Sim; Falk Müller-Riemenschneider; Rob M. van Dam. Diet, physical activity, and sleep in relation to postprandial glucose responses under free-living conditions: an intensive longitudinal observational study. International Journal of Behavioral Nutrition and Physical Activity. 2024. doi:10.1186/s12966-024-01693-5.'
  doi: 10.1186/s12966-024-01693-5
  url: https://doi.org/10.1186/s12966-024-01693-5
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1186/s12966-024-01693-5
    url: https://doi.org/10.1186/s12966-024-01693-5
  canonicalUrl: https://doi.org/10.1186/s12966-024-01693-5
  identityAliases:
  - doi:10.1186/s12966-024-01693-5
researchEvidence:
  designKind: prospective_cohort
  designLabel: Intensive longitudinal free-living observational CGM study
  participantCount: 789
  participantCountKind: reported
  populationLabel: Singapore men and women aged 21–69 years without diabetes.
  durationLabel: Nine free-living days with smartphone meal logging, accelerometry, and continuous glucose monitoring.
  aggregateRole: primary
  cohortKey: cohort:doi-10.1186-s12966-024-01693-5
  notes:
  - Observational design cannot establish causality
  - Not a prescribed walking-after-every-meal intervention
  - Asian adults without diabetes; results may not generalize to diabetes, pregnancy, or older/frailer populations
  - Self-reported meal timing and residual confounding remain possible
  - 'Directness boundary: adjacent_variant'
evidenceBucket: secondary-metabolism-lipids-insulin-cgm
whyItMatters: Adds high-resolution free-living context for how post-meal activity relates to CGM glucose responses outside a laboratory.
potentialMurphEndpoints:
- 2-hour postprandial glucose incremental area under the curve by CGM
- postprandial LPA and MVPA exposure
- meal, sleep, and activity context
protocolTakeaway: Use as mechanistic/context evidence only; do not treat the activity-glucose associations as causal proof that walking after every meal lowers glucose.
murphTakeaway: Useful for selecting CGM iAUC and post-meal activity windows as experiment signals, with confounding clearly flagged.
studyDesign: cohort
modality: free-living postprandial physical activity; CGM and accelerometry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **secondary-metabolism-lipids-insulin-cgm**.

**Findings:** Free-living CGM and accelerometry data linked more post-meal activity with lower 2-hour glucose excursions, but the study was observational and not a prescribed walking protocol.

**Why it matters:** Adds high-resolution free-living context for how post-meal activity relates to CGM glucose responses outside a laboratory.

**Potential experiment signals:** 2-hour postprandial glucose incremental area under the curve by CGM, postprandial LPA and MVPA exposure, meal, sleep, and activity context.

**Protocol takeaway:** Use as mechanistic/context evidence only; do not treat the activity-glucose associations as causal proof that walking after every meal lowers glucose.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Singapore men and women aged 21–69 years without diabetes.

- **Participant count:** 789

- **Intervention/exposure:** Postprandial light physical activity and moderate-to-vigorous physical activity measured during the 2 hours after self-reported meals.

- **Comparator/control:** Within-person periods/meals with lower postprandial physical activity exposure.

- **Duration/follow-up:** Nine free-living days with smartphone meal logging, accelerometry, and continuous glucose monitoring.

- **Endpoints:** 2-hour postprandial glucose incremental area under the curve by CGM; postprandial LPA and MVPA exposure; meal, sleep, and activity context

- **Effect estimates or direction:** Longer postprandial LPA was associated with lower 2-hour glucose iAUC (β -24.7, 95% CI -39.5 to -9.9 per hour); MVPA was also associated with lower iAUC (β -58.0, 95% CI -73.8 to -42.3 per hour). This is observational association, not causal protocol evidence.

- **Adverse events/safety notes:** No protocol-specific adverse events were reported for a prescribed after-meal walking intervention because activity was observed rather than assigned.

- **Limitations:** Observational design cannot establish causality; Not a prescribed walking-after-every-meal intervention; Asian adults without diabetes; results may not generalize to diabetes, pregnancy, or older/frailer populations; Self-reported meal timing and residual confounding remain possible

- **Population mismatch:** Adjacent free-living observational evidence in adults without diabetes, not a direct after-every-meal walking trial.

- **Directness to Walking After Every Meal:** adjacent_variant

- **Artifact candidates and rights:** Rights status in the canonical ledger is `open_access`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.


## Atomic finding links

- `finding:walking-after-every-meal:doi-10.1186-s12966-024-01693-5:001`
