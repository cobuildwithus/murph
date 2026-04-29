---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1123-jpah.3.1.1
slug: sources/daily-step-floor/doi-10.1123-jpah.3.1.1
title: '10,000 Steps Rockhampton: Evaluation of a Whole Community Approach to Improving Population Levels of Physical Activity'
summary: Whole-community Rockhampton evaluation found high awareness and mixed/modest activity signals; adjacent external protocol evidence only.
status: draft
quality: usable
aliases:
- 10,000 Steps Rockhampton evaluation
- doi-10.1123-jpah.3.1.1
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: '10,000 Steps Rockhampton: Evaluation of a Whole Community Approach to Improving Population Levels of Physical Activity'
  authors: Brown WJ, Mummery WK, Eakin E, Schofield G
  year: 2006
  journal: Journal of Physical Activity and Health
  doi: 10.1123/jpah.3.1.1
  url: https://journals.humankinetics.com/view/journals/jpah/3/1/article-p1.xml
  citation: 'Brown WJ, Mummery WK, Eakin E, Schofield G. 10,000 Steps Rockhampton: Evaluation of a Whole Community Approach to Improving Population Levels of Physical Activity. Journal of Physical Activity and Health. 2006;3(1):1-14. doi:10.1123/jpah.3.1.1.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1123/jpah.3.1.1
    titleHash: b49b04bfff3ac447bc4b2fc1cbf04497d8e67fd7e508cc8939d303cdf280aaa8
    url: https://journals.humankinetics.com/view/journals/jpah/3/1/article-p1.xml
  canonicalUrl: https://doi.org/10.1123/jpah.3.1.1
researchEvidence:
  designKind: controlled_trial
  designLabel: Quasi-experimental whole-community evaluation
  populationLabel: Adults surveyed by computer-assisted telephone interview in Rockhampton intervention and Mackay comparison communities in 2001 and 2003.
  durationLabel: Approximately 2 years between 2001 baseline and 2003 follow-up surveys.
  cohortKey: cohort:daily-step-floor/doi-10.1123-jpah.3.1.1
  participantCount: 4468
  aggregateRole: primary
evidenceBucket: guidelines_external_protocol_context
whyItMatters: Shows that community 10,000-step campaigns can have reach, but direct effects are mixed and not equivalent to an individual step-floor experiment.
potentialMurphEndpoints:
- physical_activity_minutes
- daily_step_count
- program_reach
- step_goal_attainment
protocolTakeaway: Use as adjacent-variant context only; do not claim a standalone Daily Step Floor effect from this community campaign.
murphTakeaway: If cited, preserve the mixed result and note that community supports, self-report, and nonrandomization limit directness.
studyDesign: quasi_experimental_community_evaluation
modality: community_step_program_context
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/doi-10.1123-jpah.3.1.1/community-result
  sourceKey: source_artifact:doi-10.1123-jpah.3.1.1
  extractedFromArtifactId: art_doi_10_1123_jpah_3_1_1_source_extract
  findingKind: intervention_result
  population: Adults surveyed by computer-assisted telephone interview in Rockhampton intervention and Mackay comparison communities in 2001 and 2003.
  exposure: Whole-community 10,000 Steps Rockhampton campaign with social marketing, health-provider strategies, environmental strategies, and pedometer/10,000-step messaging.
  outcome: self-reported physical activity using Active Australia items; campaign awareness; pedometer use; health-provider advice; proportion sufficiently active
  summary: The Rockhampton community evaluation reported high campaign awareness and modest/mixed physical-activity signals, including a decline in the comparison community not evident in Rockhampton and a women subgroup estimate whose confidence interval crossed zero.
  evidenceUse:
  - context
  - adjacent_variant
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **guidelines_external_protocol_context**.

**Findings:** The Rockhampton community evaluation reported high campaign awareness and modest/mixed physical-activity signals, including a decline in the comparison community not evident in Rockhampton and a women subgroup estimate whose confidence interval crossed zero.

**Why it matters:** Shows that community 10,000-step campaigns can have reach, but direct effects are mixed and not equivalent to an individual step-floor experiment.

**Potential experiment signals:** physical_activity_minutes, daily_step_count, program_reach, step_goal_attainment.

**Protocol takeaway:** Use as adjacent-variant context only; do not claim a standalone Daily Step Floor effect from this community campaign.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Adults surveyed by computer-assisted telephone interview in Rockhampton intervention and Mackay comparison communities in 2001 and 2003.
- **Exposure/intervention:** Whole-community 10,000 Steps Rockhampton campaign with social marketing, health-provider strategies, environmental strategies, and pedometer/10,000-step messaging.
- **Comparator/control:** Mackay comparison community; repeated cross-sectional pre/post surveys.
- **Duration/follow-up:** Approximately 2 years between 2001 baseline and 2003 follow-up surveys.
- **Endpoints:** self-reported physical activity using Active Australia items; campaign awareness; pedometer use; health-provider advice; proportion sufficiently active
- **Effect estimates or direction:** Campaign reach and awareness increased. The comparison community proportion sufficiently active declined from 48.3% to 41.9%, while a comparable decline was not evident in Rockhampton; women in Rockhampton had a reported +5.0 percentage-point active shift with 95% CI -0.6 to 10.6.
- **Adverse events/safety notes:** No adverse events reported in the accessible extract.
- **Limitations:** Community nonrandomized design; self-reported activity; repeated cross-sectional samples; modest effect and confidence interval crossing zero for the women subgroup estimate.
- **Population mismatch:** Whole-community external campaign with environmental/social supports, not a personal wearable-tracked Daily Step Floor.
- **Artifact rights:** permission_required
