---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1080-1612197x.2020.1854820
slug: sources/daily-step-floor/doi-10.1080-1612197x.2020.1854820
title: Normalised Step Targets in Fitness Apps Affect Users’ Autonomy Need Satisfaction, Motivation and Physical Activity – A Six-Week RCT
summary: Fitness-app RCT warns that normalized step targets can have mixed motivation/autonomy effects.
status: draft
quality: usable
aliases:
- doi-10.1080-1612197x.2020.1854820
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Normalised Step Targets in Fitness Apps Affect Users’ Autonomy Need Satisfaction, Motivation and Physical Activity – A Six-Week RCT
  authors: Lena Busch; Till Utesch; Bernd Strauss
  year: 2022
  journal: International Journal of Sport and Exercise Psychology
  doi: 10.1080/1612197x.2020.1854820
  url: https://doi.org/10.1080/1612197X.2020.1854820
  citation: Busch L, Utesch T, Strauss B. Normalised Step Targets in Fitness Apps Affect Users’ Autonomy Need Satisfaction, Motivation and Physical Activity – A Six-Week RCT. International Journal of Sport and Exercise Psychology. 2022;20(1):223-244. doi:10.1080/1612197X.2020.1854820
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1080/1612197x.2020.1854820
    titleHash: 2aeea2d5a01e9b0aad27b36d4286921c6f0ab21d444c3032338110e8010ceb58
    url: https://doi.org/10.1080/1612197X.2020.1854820
  canonicalUrl: https://doi.org/10.1080/1612197X.2020.1854820
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Six-week randomized controlled trial of fitness-app step targets
  populationLabel: Young adult fitness-app/self-tracking participants
  durationLabel: 6 weeks
  cohortKey: daily-step-floor-doi-10.1080-1612197x.2020.1854820
  participantCount: 152
  aggregateRole: primary
evidenceBucket: mental_health_sleep_qol
whyItMatters: Important motivation and autonomy boundary source for normalized step targets.
potentialMurphEndpoints:
- biomarker:daily-steps
- biomarker:motivation
- biomarker:autonomy
- biomarker:adherence
protocolTakeaway: A fixed normalized target may raise activity but can affect autonomy/motivation differently than individualized self-tracking; Daily Step Floor should allow autonomy and ramping.
murphTakeaway: Use as context for goal-burden and autonomy design choices.
studyDesign: randomized_controlled_trial
modality: daily-step / pedometer / walking
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1080-1612197x.2020.1854820:mental-health-sleep-qol
  sourceKey: source_artifact:doi-10.1080-1612197x.2020.1854820
  extractedFromArtifactId: art_doi_10_1080_1612197x_2020_1854820
  findingKind: context
  population: Young adult fitness-app/self-tracking participants
  exposure: Fitness-app self-tracking with a normalized 10,000-step target or self-tracking without a normalized target
  outcome: physical activity; autonomy need satisfaction; motivation regulation; amotivation
  summary: A 6-week RCT of 152 fitness-app participants found increased physical activity in fitness-tracker groups but mixed motivational effects of normalized step targets, with autonomy benefits more apparent without a normalized target.
  evidenceUse:
  - mechanism
  - context
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **mental_health_sleep_qol**.

**Findings:** A 6-week RCT of 152 fitness-app participants found increased physical activity in fitness-tracker groups but mixed motivational effects of normalized step targets, with autonomy benefits more apparent without a normalized target.

**Why it matters:** Important motivation and autonomy boundary source for normalized step targets.

**Potential experiment signals:** biomarker:daily-steps, biomarker:motivation, biomarker:autonomy, biomarker:adherence.

**Protocol takeaway:** A fixed normalized target may raise activity but can affect autonomy/motivation differently than individualized self-tracking; Daily Step Floor should allow autonomy and ramping.

**Claim use:** `context-only`.

**Directness boundary:** This source is classified as `same_mechanism` for Daily Step Floor. Do not promote adjacent, observational, registry/protocol, or clinical-population findings into direct protocol claims.

**Safety/adverse events:** No adverse-event details were extracted from accessible article metadata/abstract.
