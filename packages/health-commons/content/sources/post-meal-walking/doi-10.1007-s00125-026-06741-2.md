---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007-s00125-026-06741-2
slug: sources/post-meal-walking/doi-10.1007-s00125-026-06741-2
title: 'Exercise snacks performed in real-world settings reduce postprandial hyperglycaemia and glycaemic variability in individuals living with type 2 diabetes: a randomised crossover study'
summary: Open-access 2026 randomized crossover study in 31 non-insulin-treated adults with type 2 diabetes; vigorous bodyweight exercise snacks lowered glycemic variability and breakfast/dinner postprandial metrics, while the primary 48-hour mean glucose endpoint was not statistically significant.
status: draft
quality: usable
aliases:
- doi:10.1007/s00125-026-06741-2
- Diabetologia 2026 exercise snacks
- ClinicalTrials.gov NCT06382246
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
  title: 'Exercise snacks performed in real-world settings reduce postprandial hyperglycaemia and glycaemic variability in individuals living with type 2 diabetes: a randomised crossover study'
  authors: Fiona J. Babir; Alexis Marcotte-Chénard; Roderick E. Sandilands; Angelina D’Amico; Kaja Falkenhain; Noah Mulkewich; Hashim Islam; Douglas L. Richards; Kenneth Madden; Joel Singer; Michael Riddell; Martin J. Gibala; Jonathan P. Little
  year: 2026
  journal: Diabetologia
  citation: 'Babir FJ, Marcotte-Chénard A, Sandilands RE, et al. Exercise snacks performed in real-world settings reduce postprandial hyperglycaemia and glycaemic variability in individuals living with type 2 diabetes: a randomised crossover study. Diabetologia. 2026. doi:10.1007/s00125-026-06741-2.'
  doi: 10.1007/s00125-026-06741-2
  url: https://link.springer.com/article/10.1007/s00125-026-06741-2
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1007/s00125-026-06741-2
    url: https://link.springer.com/article/10.1007/s00125-026-06741-2
  canonicalUrl: https://link.springer.com/article/10.1007/s00125-026-06741-2
  identityAliases:
  - doi:10.1007/s00125-026-06741-2
  - Diabetologia 2026 exercise snacks
  - ClinicalTrials.gov NCT06382246
researchEvidence:
  designKind: crossover_trial
  designLabel: Real-world randomized crossover exercise-snacks study
  participantCount: 31
  participantCountKind: reported
  populationLabel: Previously inactive adults with well-controlled, non-insulin-treated type 2 diabetes; age 30–75 years eligibility, HbA1c ≤8.5%, <150 min/week aerobic exercise.
  durationLabel: Two 48-hour conditions in real-world setting with standardized diet, separated by a 24-hour washout over 5 days.
  aggregateRole: primary
  cohortKey: cohort:doi-10.1007-s00125-026-06741-2
  notes:
  - 'Adjacent variant: vigorous bodyweight exercise snacks, not walking.'
  - Primary mean glucose endpoint was not statistically significant.
  - Small significant effects were reported for variability and selected 2-hour postprandial outcomes.
  - Short 48-hour condition; clinical significance over weeks/months unknown.
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: This is fresh real-world adherence and timing/dose context for meal-adjacent activity in T2D, but it must not be promoted to walking-specific evidence.
potentialMurphEndpoints:
- 48-hour mean glucose by CGM
- 2-hour postprandial glucose average, peak, AUC, and iAUC
- glycemic variability
- time in tight range
- self-reported exercise-snack adherence
protocolTakeaway: Use as adjacent real-world dose/context evidence; preserve the null primary endpoint and the small magnitude of benefits.
murphTakeaway: Very small amounts of intense activity may shift variability and meal windows, but a walking protocol should track whether benefits are meal-level, whole-day, or both.
studyDesign: crossover
modality: vigorous bodyweight exercise snacks encouraged near meals
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** Four 1-minute vigorous exercise snacks per day produced small improvements in glycemic variability and breakfast/dinner postprandial metrics, but the primary 48-hour mean glucose comparison did not reach statistical significance.

**Why it matters:** This is fresh real-world adherence and timing/dose context for meal-adjacent activity in T2D, but it must not be promoted to walking-specific evidence.

**Potential experiment signals:** 48-hour mean glucose by CGM, 2-hour postprandial glucose average, peak, AUC, and iAUC, glycemic variability, time in tight range, self-reported exercise-snack adherence.

**Protocol takeaway:** Use as adjacent real-world dose/context evidence; preserve the null primary endpoint and the small magnitude of benefits.

**Claim use:** `context-only`.

## Extraction details

- **Population:** 31 previously inactive adults with well-controlled, non-insulin-treated type 2 diabetes completed both conditions; 21 female and 10 male participants.

- **Participant count:** 31 completed both conditions.

- **Intervention/exposure:** Four 1-minute vigorous bodyweight exercise snacks per day on two consecutive days, guided by email/video, with encouragement to perform snacks within 30–60 minutes after major meals; Fitbit used for heart-rate logging.

- **Comparator/control:** Two consecutive days of no exercise under an equivalent standardized diet; participants were asked to avoid other structured exercise, including leisure-time walking.

- **Duration/follow-up:** Each condition lasted 48 hours; conditions were separated by a 24-hour washout over a 5-day protocol.

- **Endpoints:** Primary: 48-hour mean glucose by CGM. Secondary: 2-hour postprandial glucose average, peak, SD, AUC, iAUC; glycemic variability (CV, SD, MAGE); time in range, time in tight range, time above/below range; adherence/activity metrics.

- **Effect estimates or direction:** Mean glucose difference did not reach statistical significance (−0.2 mmol/L; 95% CI −0.4 to 0.0; p=0.07). ES improved SD (−0.1 mmol/L; p<0.001), CV (−1%; p=0.007), MAGE (−0.3 mmol/L; p=0.04), and time in tight range (+3%; p=0.04). Breakfast and dinner 2-hour postprandial average, peak, AUC, and iAUC were lower; lunch outcomes were mostly null except SD.

- **Adverse events/safety notes:** No adverse-event signal was extracted from the article lines reviewed.

- **Limitations:** Not walking; vigorous bodyweight snacks; very short 48-hour conditions; standardized diet; well-controlled non-insulin-treated T2D; small effect magnitudes; long-term clinical significance unknown.

- **Population mismatch:** T2D is relevant, but activity modality and intensity differ from low-intensity walking after every meal.

- **Directness to Walking After Every Meal:** adjacent_variant

- **Artifact candidates and rights:** Open-access article under CC BY-NC-ND 4.0; keep metadata/source-page draft and avoid vendoring adapted material or publisher PDFs without a rights check.

## Atomic finding links

- `finding:walking-after-every-meal:doi-10.1007-s00125-026-06741-2:001`
- `finding:walking-after-every-meal:doi-10.1007-s00125-026-06741-2:002`
