---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007-s12662-022-00821-2
slug: sources/daily-step-floor/doi-10.1007-s12662-022-00821-2
title: 'Self-tracking of daily physical activity using a fitness tracker and the effect of the 10,000 steps goal: A 6-week randomized controlled parallel group trial'
summary: A 6-week RCT in young adults found that Fitbit self-tracking and an externally assigned 10,000-step goal did not drive greater physical activity behavior compared with alternatives.
status: draft
quality: usable
aliases:
- 'Self-tracking of daily physical activity using a fitness tracker and the effect of the 10,000 steps goal: A 6-week randomized controlled parallel group trial'
- DOI 10.1007/s12662-022-00821-2
- doi-10.1007-s12662-022-00821-2
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: 'Self-tracking of daily physical activity using a fitness tracker and the effect of the 10,000 steps goal: A 6-week randomized controlled parallel group trial'
  authors: Utesch T; Piesch L; Busch L; Strauss B; Geukes K
  year: 2022
  journal: German Journal of Exercise and Sport Research
  doi: 10.1007/s12662-022-00821-2
  url: https://link.springer.com/article/10.1007/s12662-022-00821-2
  citation: 'Utesch T; Piesch L; Busch L; Strauss B; Geukes K. Self-tracking of daily physical activity using a fitness tracker and the effect of the 10,000 steps goal: A 6-week randomized controlled parallel group trial. German Journal of Exercise and Sport Research. 2022. doi:10.1007/s12662-022-00821-2.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1007/s12662-022-00821-2
    titleHash: f5412036f0c681fceca8f3b425985242d079916776e032a5607e864336080693
    url: https://link.springer.com/article/10.1007/s12662-022-00821-2
  canonicalUrl: https://link.springer.com/article/10.1007/s12662-022-00821-2
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: 6-week randomized controlled parallel-group trial
  populationLabel: Young adults aged 18 to 40 years who exercised less than 4 hours/week; mostly women and WEIRD sample.
  durationLabel: 6 weeks.
  cohortKey: daily-step-floor/batch-003
  participantCount: 150
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: baseline_plus_ramp_trials
whyItMatters: Important null/mixed source warning against assuming a generic fixed 10,000-step goal is effective.
potentialMurphEndpoints:
- daily steps
- self-reported PA
- individual response heterogeneity
protocolTakeaway: Do not frame Daily Step Floor as a fixed 10,000-step default for everyone.
murphTakeaway: Personalize floors rather than relying on standard app defaults.
studyDesign: randomized_controlled_parallel_group_trial
modality: walking / daily step-count behavior
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1007-s12662-022-00821-2:primary
  sourceKey: source_artifact:doi-10.1007-s12662-022-00821-2
  extractedFromArtifactId: art_doi_10_1007_s12662_022_00821_2_primary
  findingKind: intervention_result
  population: Young adults aged 18 to 40 years who exercised less than 4 hours/week; mostly women and WEIRD sample.
  exposure: Fitbit Flex 2 self-tracking with an externally assigned 10,000 steps/day goal.
  outcome: daily steps; self-reported physical activity; activity trajectory
  summary: A 6-week RCT in young adults found that Fitbit self-tracking and an externally assigned 10,000-step goal did not drive greater physical activity behavior compared with alternatives.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **baseline_plus_ramp_trials**.

**Findings:** A 6-week RCT in young adults found that Fitbit self-tracking and an externally assigned 10,000-step goal did not drive greater physical activity behavior compared with alternatives.

**Why it matters:** Important null/mixed source warning against assuming a generic fixed 10,000-step goal is effective.

**Potential experiment signals:** daily steps, self-reported PA, individual response heterogeneity.

**Protocol takeaway:** Do not frame Daily Step Floor as a fixed 10,000-step default for everyone.

**Claim use:** `context-only`.

## Extracted study details

- **Population:** Young adults aged 18 to 40 years who exercised less than 4 hours/week; mostly women and WEIRD sample.
- **Intervention or exposure:** Fitbit Flex 2 self-tracking with an externally assigned 10,000 steps/day goal.
- **Comparator or control:** Fitbit self-tracking without a step goal and an unequipped control with daily self-reports.
- **Duration or follow-up:** 6 weeks.
- **Endpoints:** daily steps, self-reported physical activity, activity trajectory
- **Effect estimates or direction:** Mixed-effect multilevel analyses suggested that fitness-tracker activity self-tracking and an externally assigned 10,000-step goal did not drive greater physical activity behavior; substantial individual differences were observed.
- **Adverse events or safety notes:** Adverse-event reporting was not extracted from accessible records.
- **Limitations:** Short duration, young mostly female WEIRD sample, self-reported PA comparator, and fixed 10,000 target rather than baseline-plus goal.
- **Population mismatch:** Young healthy adults; not older, clinical, or low-active primary-care population.
- **Directness to Daily Step Floor:** `direct_protocol`
- **Artifact and rights boundary:** PDF/artifact rights status is `open_access`. Do not commit copyrighted PDFs unless redistribution rights are explicit.
