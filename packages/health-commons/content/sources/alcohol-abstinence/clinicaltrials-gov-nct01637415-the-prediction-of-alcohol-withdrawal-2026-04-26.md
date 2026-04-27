---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
slug: sources/alcohol-abstinence/clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
title: 'The Prediction of Alcohol Withdrawal Severity Scale (PAWSS): Development and Psychometric Characteristics of a New Scale for the Prediction of Complicated Alcohol Withdrawal Syndrome'
summary: Registry context for the PAWSS validation program and eligibility/exclusion criteria; useful for population and setting caveats.
status: draft
quality: usable
aliases:
- source_artifact:clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
- clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
- NCT01637415
- candidate:withdrawal-safety-screening:021
categories:
- alcohol-abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: other
  title: 'The Prediction of Alcohol Withdrawal Severity Scale (PAWSS): Development and Psychometric Characteristics of a New Scale for the Prediction of Complicated Alcohol Withdrawal Syndrome'
  authors: Stanford University; José R. Maldonado
  journal: ClinicalTrials.gov
  citation: 'Stanford University; José R. Maldonado. The Prediction of Alcohol Withdrawal Severity Scale (PAWSS): Development and Psychometric Characteristics of a New Scale for the Prediction of Complicated Alcohol Withdrawal Syndrome. ClinicalTrials.gov.'
  url: https://clinicaltrials.gov/study/NCT01637415
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT01637415
    titleHash: d3064967ad8450ddb0f64a76192dadb2a44935be254bf68c9516a46371eae88a
    url: https://clinicaltrials.gov/study/NCT01637415
  canonicalUrl: https://clinicaltrials.gov/study/NCT01637415
researchEvidence:
  designKind: other
  designLabel: other
  populationLabel: Hospitalized medically ill adults, age 18 years or older, admitted within the prior 24 hours.
  durationLabel: Hospital admission/validation context; follow-up duration not extracted from the batch materials.
  aggregateRole: primary
  cohortKey: clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
  notes:
  - Registry record; no efficacy estimate extracted.
evidenceBucket: withdrawal risk and safety screening
whyItMatters: Registry context for the PAWSS validation program and eligibility/exclusion criteria; useful for population and setting caveats.
potentialMurphEndpoints:
- complicated withdrawal
- seizures
- hallucinosis
- delirium tremens
- risk screening
protocolTakeaway: Use this source for withdrawal-risk screening and acute safety boundaries only; do not cite it as efficacy evidence for a 7-, 14-, or 30-day alcohol-free challenge.
murphTakeaway: Use only to understand the safety-screen lineage and setting caveats for PAWSS-style questions before an abstinence challenge. A registry page is not a results paper and should not be used for challenge benefit claims.
studyDesign: other
modality: Alcohol withdrawal risk screening and safety guidance
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
  sourceKey: source_artifact:clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
  extractedFromArtifactId: art_clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
  findingKind: measurement_validation
  population: Hospitalized medically ill adults, age 18 years or older, admitted within the prior 24 hours.
  exposure: Psychometric evaluation and predictive validation of PAWSS for complicated alcohol withdrawal risk.
  outcome: complicated withdrawal, seizures, hallucinosis, delirium tremens, risk screening
  summary: ClinicalTrials.gov registry context for the PAWSS validation program in hospitalized medically ill adults. The record is useful for population, setting, and exclusion criteria around prediction of complicated alcohol withdrawal, not for alcohol-free challenge efficacy.
  evidenceUse:
  - measurement
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Psychometric evaluation and predictive validation of PAWSS for complicated alcohol withdrawal risk.
comparatorOrControl: No protocol comparator extracted from registry metadata.
durationOrFollowUp: Hospital admission/validation context; follow-up duration not extracted from the batch materials.
endpoints:
- complicated withdrawal
- seizures
- hallucinosis
- delirium tremens
- risk screening
effectEstimatesOrDirection: Registry record; no efficacy estimate extracted.
adverseEventsOrSafetyNotes: ClinicalTrials.gov registry context for the PAWSS validation program in hospitalized medically ill adults. The record is useful for population, setting, and exclusion criteria around prediction of complicated alcohol withdrawal, not for alcohol-free challenge efficacy.
limitations:
- Registry entry only; outcome results must come from linked publications.
- Hospitalized medically ill adults differ from general wellness challengers.
populationMismatch: Hospitalized medically ill adults, not unsupervised 7-, 14-, or 30-day alcohol-free challengers.
directnessToProtocol: clinical_supervised
claimUseBoundary: Safety-only/context boundary. This source should not be promoted into direct protocol efficacy claims.
artifactCandidates:
- art_clinicaltrials-gov-nct01637415-the-prediction-of-alcohol-withdrawal-2026-04-26
---


This source is included for **Withdrawal-risk screening and acute safety guidance**.

**Findings:** ClinicalTrials.gov registry context for the PAWSS validation program in hospitalized medically ill adults. The record is useful for population, setting, and exclusion criteria around prediction of complicated alcohol withdrawal, not for alcohol-free challenge efficacy.

**Why it matters:** Registry context for the PAWSS validation program and eligibility/exclusion criteria; useful for population and setting caveats.

**Potential experiment signals:** complicated withdrawal, seizures, hallucinosis, delirium tremens, risk screening.

**Protocol takeaway:** Use as safety-screening or escalation evidence only. It does not support efficacy claims for 7-, 14-, or 30-day alcohol-free variants.

**Claim use:** `safety-only`.
