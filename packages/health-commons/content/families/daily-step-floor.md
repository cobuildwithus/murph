---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:daily-step-floor
slug: families/daily-step-floor
title: Daily Step Floor
summary: A daily minimum step count, where a visible floor ensures enough steady low-grade cardiovascular and weight-bearing load for the body to adapt to rather than lose.
status: field-testing
quality: usable
aliases:
- daily step goal
- daily minimum steps
- step-count floor
- steps-per-day target
- 10,000 steps challenge
- pedometer step goal
- wearable step goal
categories:
- walking
- activity
- wearable-metric
- behavior-change
- self-experiment
familyKind: intervention
canonicalModality: daily_total_step_floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: cites
  target: source_artifact:daily-step-floor-bibliography
researchCoverage:
  bibliographyKey: source_artifact:daily-step-floor-bibliography
  corpusStats:
    canonicalLedgerRecords: 334
    sourcePageDraftsRecovered: 320
    metadataOnlyStubsGenerated: 14
    standaloneEvidenceAppraisals: 323
    artifactCandidates: 335
    largestExtractionBatchSize: 36
    auditCutoff: '2026-04-28'
---

Daily Step Floor is the family for experiments where the core dose is a **daily total-step minimum** measured with a consistent phone, wearable tracker, or pedometer.

## What belongs in this family

Use this family for fixed, baseline-plus, or ramped total-step floors when the intervention question is whether the user can sustain more daily steps. Common public targets such as 10,000 steps/day can be listed as examples, but they are commitment tiers rather than evidence-equivalent thresholds or a universal definition of the family [source_artifact:pmid-33036635; source_artifact:pmid-18029834; source_artifact:pmid-14715035; source_artifact:pmid-21798044; source_artifact:pmid-35247352; source_artifact:pmid-40713949].

## What stays separate

Keep cadence or MVPA prescriptions, post-meal walking, structured aerobic training, running programs, supervised rehabilitation, disease-treatment protocols, diabetes foot-care or offloading plans, coached weight-loss programs, workplace competitions, family/team gamification, and incentive programs in separate protocol variants unless the page explicitly makes those components the tested dose [source_artifact:pmid-28459099; source_artifact:pmid-24528783; source_artifact:pmid-26881417; source_artifact:pmid-28973115; source_artifact:doi-10.1016-j.bjpt.2023.100500].

## How to read the evidence

The clean claim is behavioral: step-count monitoring and daily step targets can increase steps in many adult samples. Health outcomes are secondary and mixed, cut-point evidence is often observational, and measurement validity depends on device and use context [source_artifact:pmid-18029834; source_artifact:pmid-19791652; source_artifact:pmid-33036635; source_artifact:pmid-16979410; source_artifact:pmid-33361276].

## Safety boundary

The family should remain safety-first. A daily floor is not appropriate as an unsupervised escalation when the user has very low baseline activity, frailty, injury recovery requiring restrictions, red-flag cardiopulmonary symptoms, meaningful fall risk, active foot wounds or diabetic-foot risk, worsening pain, acute illness, unsafe heat or route conditions, pregnancy/postpartum restrictions, or clinician-imposed activity limits [source_artifact:pmid-15921486; source_artifact:daily-step-floor-pmid-17521443; source_artifact:pmid-26289360; source_artifact:doi-10.1016-j.diabres.2021.108733; source_artifact:pmid-29961442; source_artifact:healthgov-physical-activity-guidelines-americans-2018-11-12; source_artifact:govuk-physical-activity-guidelines-2019-09-07; source_artifact:who-physical-activity-guidelines-2020-11-25].
