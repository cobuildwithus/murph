---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.2174-1874288200802010094
slug: sources/post-meal-walking/doi-10.2174-1874288200802010094
title: Very light Physical Activity after a Meal Blunts the Rise in Blood Glucose and Insulin
summary: A small acute study found very-light postmeal cycling blunted glucose and insulin rises after a cornflakes meal, but it is not walking-specific.
status: draft
quality: usable
aliases:
- doi:10.2174/1874288200802010094
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
  title: Very light Physical Activity after a Meal Blunts the Rise in Blood Glucose and Insulin
  authors: Eivind Aadland; Arne T. Høstmark
  year: 2008
  journal: The Open Nutrition Journal
  citation: Eivind Aadland; Arne T. Høstmark. Very light Physical Activity after a Meal Blunts the Rise in Blood Glucose and Insulin. The Open Nutrition Journal. 2008. doi:10.2174/1874288200802010094.
  doi: 10.2174/1874288200802010094
  url: https://benthamopen.com/ABSTRACT/TONUTRJ-2-94
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.2174/1874288200802010094
    url: https://benthamopen.com/ABSTRACT/TONUTRJ-2-94
  canonicalUrl: https://benthamopen.com/ABSTRACT/TONUTRJ-2-94
  identityAliases:
  - doi:10.2174/1874288200802010094
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Small acute crossover meal-and-cycling physiology study
  participantCount: 9
  participantCountKind: reported
  populationLabel: Nine healthy adults (6 men, 3 women; mean age about 37 years).
  durationLabel: Single post-meal test with 165 minutes of blood sampling.
  aggregateRole: primary
  cohortKey: cohort:doi-10.2174-1874288200802010094
  notes:
  - Very small sample
  - Cycling rather than walking
  - Cornflakes challenge meal rather than normal meals
  - Acute laboratory physiology only
  - Healthy adults, not diabetes or pregnancy population
  - 'Directness boundary: same_mechanism'
evidenceBucket: secondary-metabolism-lipids-insulin-cgm
whyItMatters: Supports the low-intensity muscle-activity mechanism for postprandial glucose and insulin handling while keeping modality differences explicit.
potentialMurphEndpoints:
- postprandial blood glucose
- insulin AUC and incremental AUC
- glucose and insulin peaks
protocolTakeaway: Use as same-mechanism insulin/glucose context, not as direct evidence for walking after every meal.
murphTakeaway: Insulin and glucose peaks are plausible experiment signals when CGM or labs are available.
studyDesign: acute_physiology
modality: very-light postmeal cycling
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **secondary-metabolism-lipids-insulin-cgm**.

**Findings:** A small acute study found very-light postmeal cycling blunted glucose and insulin rises after a cornflakes meal, but it is not walking-specific.

**Why it matters:** Supports the low-intensity muscle-activity mechanism for postprandial glucose and insulin handling while keeping modality differences explicit.

**Potential experiment signals:** postprandial blood glucose, insulin AUC and incremental AUC, glucose and insulin peaks.

**Protocol takeaway:** Use as same-mechanism insulin/glucose context, not as direct evidence for walking after every meal.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Nine healthy adults (6 men, 3 women; mean age about 37 years).

- **Participant count:** 9

- **Intervention/exposure:** Thirty minutes of very-light or light bicycle activity after a cornflakes meal.

- **Comparator/control:** Same meal without postprandial physical activity.

- **Duration/follow-up:** Single post-meal test with 165 minutes of blood sampling.

- **Endpoints:** postprandial blood glucose; insulin AUC and incremental AUC; glucose and insulin peaks

- **Effect estimates or direction:** Both postmeal activity bouts blunted or delayed glucose and insulin rises. Very-light activity reduced insulin AUC versus control (3655.8 ± 1834.6 vs 4905.1 ± 2807.1 μIU/ml*min, p=0.014), insulin iAUC (2751.2 ± 1588.1 vs 4067.3 ± 2539.7, p=0.010), and insulin peak (44.3 ± 15.1 vs 68.3 ± 27.4, p=0.005). Light cycling had similar direction but did not remain significant after Bonferroni adjustment.

- **Adverse events/safety notes:** No adverse-event signal was extracted from the source record.

- **Limitations:** Very small sample; Cycling rather than walking; Cornflakes challenge meal rather than normal meals; Acute laboratory physiology only; Healthy adults, not diabetes or pregnancy population

- **Population mismatch:** Same mechanism but different modality: very-light cycling after a meal rather than walking after every meal.

- **Directness to Walking After Every Meal:** same_mechanism

- **Artifact candidates and rights:** Rights status in the canonical ledger is `open_access`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.


## Atomic finding links

- `finding:walking-after-every-meal:doi-10.2174-1874288200802010094:001`
