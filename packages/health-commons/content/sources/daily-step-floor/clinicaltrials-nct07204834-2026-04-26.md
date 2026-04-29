---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct07204834-2026-04-26
slug: sources/daily-step-floor/clinicaltrials-nct07204834-2026-04-26
title: A Physical Activity Program for People With Heart Failure
summary: Registry record describes a supervised step- and cadence-progressive physical-activity program for adults with heart failure; no results are available yet.
status: draft
quality: usable
aliases:
- Universidad de Granada et al. 2026 A Physical Activity Program for People With Heart Failure
- clinicaltrials-nct07204834-2026-04-26
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: external_protocol
  title: A Physical Activity Program for People With Heart Failure
  authors: Universidad de Granada
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07204834
  citation: ClinicalTrials.gov. A Physical Activity Program for People With Heart Failure. NCT07204834. Accessed 2026-04-26.
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT07204834
    titleHash: f3f2515a08b92b3d97e8166f5775d11a333da389c6ef6e2be8ef7672eed64aa9
    url: https://clinicaltrials.gov/study/NCT07204834
  canonicalUrl: https://clinicaltrials.gov/study/NCT07204834
researchEvidence:
  designKind: retrospective_registry
  designLabel: Registered randomized trial of step-based physical activity in heart failure
  populationLabel: Adults with heart failure with reduced or mildly reduced ejection fraction and NYHA functional class II or III.
  durationLabel: Planned 9-month intervention with assessments through 12 months.
  cohortKey: cohort:daily-step-floor/clinicaltrials-nct07204834-2026-04-26
  participantCount: 200
  aggregateRole: primary
evidenceBucket: cadence_intensity_bouts
whyItMatters: Shows how step count and cadence can be combined in a clinical program, but only under supervision and without results at extraction.
potentialMurphEndpoints:
- daily_step_count
- walking_cadence
- functional_capacity
- heart_failure_symptoms
- safety_screening
protocolTakeaway: Use as clinical-supervised context and safety boundary; do not cite as efficacy support for unsupervised Daily Step Floor.
murphTakeaway: Clinical populations may need screening, contraindication review, and supervised progression before step/cadence targets.
studyDesign: rct
modality: clinical_step_cadence_program_registry
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/clinicaltrials-nct07204834-2026-04-26/heart-failure-registry-context
  sourceKey: source_artifact:clinicaltrials-nct07204834-2026-04-26
  extractedFromArtifactId: art_clinicaltrials_nct07204834_2026_04_26_source_extract
  findingKind: context
  population: Adults with heart failure with reduced or mildly reduced ejection fraction and NYHA functional class II or III.
  exposure: Step-based physical activity intervention using wearable monitoring, personalized online platform support, behavior-change strategies, and progression of step count and cadence.
  outcome: Functional capacity; Kansas City Cardiomyopathy Questionnaire patient-reported outcomes; systemic inflammation; heart-brain outcomes; safety/eligibility criteria.
  summary: Registry record describes a supervised step- and cadence-progressive physical-activity program for adults with heart failure; no results are available yet.
  evidenceUse:
  - context
  - safety
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **cadence_intensity_bouts**.

**Findings:** Registry record describes a supervised step- and cadence-progressive physical-activity program for adults with heart failure; no results are available yet.

**Why it matters:** Shows how step count and cadence can be combined in a clinical program, but only under supervision and without results at extraction.

**Potential experiment signals:** daily_step_count, walking_cadence, functional_capacity, heart_failure_symptoms, safety_screening.

**Protocol takeaway:** Use as clinical-supervised context and safety boundary; do not cite as efficacy support for unsupervised Daily Step Floor.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Adults with heart failure with reduced or mildly reduced ejection fraction and NYHA functional class II or III.
- **Intervention/exposure:** Step-based physical activity intervention using wearable monitoring, personalized online platform support, behavior-change strategies, and progression of step count and cadence.
- **Comparator/control:** Enhanced usual care.
- **Duration/follow-up:** Planned 9-month intervention with assessments through 12 months.
- **Endpoints:** Functional capacity; Kansas City Cardiomyopathy Questionnaire patient-reported outcomes; systemic inflammation; heart-brain outcomes; safety/eligibility criteria.
- **Effect estimates or direction:** No efficacy results were available from the registry record at extraction; this is a planned/registered clinical-supervised protocol.
- **Adverse events/safety notes:** Registry eligibility excludes several higher-risk cardiac conditions such as recent decompensated heart failure, uncontrolled arrhythmia, limiting angina, severe symptomatic aortic stenosis, and persistent symptomatic hypotension.
- **Limitations:** Registry record only; results not available; clinical heart-failure supervision and eligibility restrictions limit generalization to community self-experimentation.
- **Population mismatch:** Clinical supervised heart-failure population; not general Daily Step Floor evidence.
- **Artifact candidates and rights status:** open_access; no PDF is included in Git from this extraction. Store metadata/abstract/open text only unless redistribution rights are confirmed.
