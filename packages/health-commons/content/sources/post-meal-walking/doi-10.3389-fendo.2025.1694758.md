---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3389-fendo.2025.1694758
slug: sources/post-meal-walking/doi-10.3389-fendo.2025.1694758
title: 'Daytime physical activity and nighttime glucose levels in individuals with pregnancy hyperglycemia: linking wearable activity trackers to continuous glucose monitoring'
summary: In a small pregnancy-hyperglycemia wearable study, daytime MVPA showed an unexpected positive association with nighttime glucose while LPA and total activity were not associated.
status: draft
quality: usable
aliases:
- doi:10.3389/fendo.2025.1694758
- PMC12554550
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
  title: 'Daytime physical activity and nighttime glucose levels in individuals with pregnancy hyperglycemia: linking wearable activity trackers to continuous glucose monitoring'
  authors: Bethany Rand Hallenbeck; Jill M. Maples; Scott E. Crouter; Hollie Raynor; Nikki B. Zite; Kimberly B. Fortner; Samantha F. Ehrlich
  year: 2025
  journal: Frontiers in Endocrinology
  citation: 'Bethany Rand Hallenbeck; Jill M. Maples; Scott E. Crouter; Hollie Raynor; Nikki B. Zite; Kimberly B. Fortner; Samantha F. Ehrlich. Daytime physical activity and nighttime glucose levels in individuals with pregnancy hyperglycemia: linking wearable activity trackers to continuous glucose monitoring. Frontiers in Endocrinology. 2025. doi:10.3389/fendo.2025.1694758. PMCID:PMC12554550.'
  doi: 10.3389/fendo.2025.1694758
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC12554550/
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC12554550
    doi: 10.3389/fendo.2025.1694758
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC12554550/
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC12554550/
  identityAliases:
  - doi:10.3389/fendo.2025.1694758
  - PMC12554550
researchEvidence:
  designKind: prospective_cohort
  designLabel: Wearable activity and CGM observational study in pregnancy hyperglycemia
  participantCount: 13
  participantCountKind: reported
  populationLabel: Pregnant individuals with gestational glucose intolerance or gestational diabetes with valid paired wearable and CGM data.
  durationLabel: Seven days of activity-tracker and CGM observation.
  aggregateRole: primary
  cohortKey: cohort:doi-10.3389-fendo.2025.1694758
  notes:
  - Very small analyzed sample
  - Pregnancy hyperglycemia population
  - Observational design
  - Daytime activity was not meal-timed walking
  - Diet, medication, and sleep confounding may remain
  - 'Directness boundary: adjacent_variant'
evidenceBucket: secondary-metabolism-lipids-insulin-cgm
whyItMatters: Preserves mixed pregnancy CGM context and prevents assuming that all activity timing improves every CGM metric.
potentialMurphEndpoints:
- nighttime mean glucose
- nighttime CGM area under the curve
- time in range
- wearable physical activity metrics
protocolTakeaway: Use as context-only evidence for pregnancy and nocturnal CGM outcomes; do not generalize to prescribed post-meal walking.
murphTakeaway: Nighttime glucose and pregnancy-specific monitoring need separate interpretation from standard post-meal glucose experiments.
studyDesign: observational_wearable_cgm_study
modality: wearable-measured daytime activity and CGM
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **secondary-metabolism-lipids-insulin-cgm**.

**Findings:** In a small pregnancy-hyperglycemia wearable study, daytime MVPA showed an unexpected positive association with nighttime glucose while LPA and total activity were not associated.

**Why it matters:** Preserves mixed pregnancy CGM context and prevents assuming that all activity timing improves every CGM metric.

**Potential experiment signals:** nighttime mean glucose, nighttime CGM area under the curve, time in range, wearable physical activity metrics.

**Protocol takeaway:** Use as context-only evidence for pregnancy and nocturnal CGM outcomes; do not generalize to prescribed post-meal walking.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Pregnant individuals with gestational glucose intolerance or gestational diabetes with valid paired wearable and CGM data.

- **Participant count:** 13

- **Intervention/exposure:** Daytime physical activity exposure measured by wearable activity tracker, including MVPA, LPA, total physical activity, and sedentary time.

- **Comparator/control:** Lower measured activity or sedentary exposure in observational models.

- **Duration/follow-up:** Seven days of activity-tracker and CGM observation.

- **Endpoints:** nighttime mean glucose; nighttime CGM area under the curve; time in range; wearable physical activity metrics

- **Effect estimates or direction:** In adjusted models, each additional 10 minutes of MVPA was associated with higher nighttime mean glucose (+0.86 mg/dL, 95% CI 0.002 to 1.73) and higher nocturnal AUC (+312.77 mg/dL*min, 95% CI 0.98 to 624.55). LPA, total activity, and sedentary time were not associated with nighttime glucose metrics.

- **Adverse events/safety notes:** No intervention adverse events were applicable because this was observational wearable monitoring.

- **Limitations:** Very small analyzed sample; Pregnancy hyperglycemia population; Observational design; Daytime activity was not meal-timed walking; Diet, medication, and sleep confounding may remain

- **Population mismatch:** Adjacent pregnancy-hyperglycemia wearable study; not a walking-after-each-meal trial.

- **Directness to Walking After Every Meal:** adjacent_variant

- **Artifact candidates and rights:** Rights status in the canonical ledger is `unknown`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.


## Atomic finding links

- `finding:walking-after-every-meal:doi-10.3389-fendo.2025.1694758:001`
