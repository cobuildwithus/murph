---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct01789008-interest-of-transient-elastography-in-2026-04-26
slug: sources/alcohol-abstinence/clinicaltrials-gov-nct01789008-interest-of-transient-elastography-in-2026-04-26
title: Interest of Transient Elastography in the Determination of Advanced Fibrosis in Alcoholic Liver Disease in Alcoholic Patients in Weaning
summary: ClinicalTrials.gov registry context for NCT01789008 describes transient elastography and liver biopsy/reference evaluation in alcoholic patients in weaning; it supports liver-risk measurement context only and has no extracted efficacy result.
status: draft
quality: usable
aliases:
- source_artifact:clinicaltrials-gov-nct01789008-interest-of-transient-elastography-in-2026-04-26
- clinicaltrials-gov-nct01789008-interest-of-transient-elastography-in-2026-04-26
- NCT01789008
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
  kind: external_protocol
  title: Interest of Transient Elastography in the Determination of Advanced Fibrosis in Alcoholic Liver Disease in Alcoholic Patients in Weaning
  authors: ClinicalTrials.gov
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Interest of Transient Elastography in the Determination of Advanced Fibrosis in Alcoholic Liver Disease in Alcoholic Patients in Weaning. ClinicalTrials.gov. NCT01789008.
  url: https://clinicaltrials.gov/study/NCT01789008
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT01789008
    titleHash: d7251ab46088059fe5ae996ea968be0ecbda4cc486ffa02b883a83b623641775
    url: https://clinicaltrials.gov/study/NCT01789008
  canonicalUrl: https://clinicaltrials.gov/study/NCT01789008
researchEvidence:
  designKind: other
  designLabel: other
  participantCount: 300
  participantCountKind: approximate
  populationLabel: Alcoholic patients in weaning/withdrawal being evaluated for alcohol-related liver disease and advanced fibrosis.
  durationLabel: Registry context; follow-up duration not extracted from the batch materials.
  aggregateRole: primary
  cohortKey: clinicaltrials-gov-nct01789008-interest-of-transient-elastography-in-2026-04-26
  notes:
  - 'source-index.json absent in supplied snapshot; identity checked against fallback content/sources inventory; candidate shard 03-discovery-one-month-abstinence-labs; duration cluster(s): 28-31-day; discovery directness guess(es): safety_boundary; discovery claim-use guess(es): context-only; discovery relevance guess(es): medium; registry record retained separately from any publication record; candidate rationale: Registry provenance for liver-stiffness evidence; not direct protocol evidence.'
evidenceBucket: clinical supervised abstinence, AUD, or liver-disease context
whyItMatters: Registry provenance for liver-stiffness evidence; not direct protocol evidence.
potentialMurphEndpoints:
- transient elastography
- liver stiffness
- advanced fibrosis
- alcohol-related liver disease
- diagnostic accuracy
protocolTakeaway: Use only for liver-disease measurement context; do not cite as proof that short abstinence improves liver outcomes.
murphTakeaway: Use as provenance for liver-stiffness measurement context and diagnostic caution around alcohol withdrawal/liver disease. Registry metadata is not an efficacy result and should not support protocol benefit claims.
studyDesign: other
modality: Clinical supervised abstinence, AUD detox, and liver-disease biomarker context
claimUse: context-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/clinicaltrials-gov-nct01789008-interest-of-transient-elastography-in-2026-04-26-transient-elastography-registry-context
  sourceKey: source_artifact:clinicaltrials-gov-nct01789008-interest-of-transient-elastography-in-2026-04-26
  extractedFromArtifactId: art_clinicaltrials_gov_nct01789008_interest_of_transient_elastography_in_2026_04_26
  findingKind: measurement_validation
  population: Alcoholic patients in weaning/withdrawal being evaluated for alcohol-related liver disease and advanced fibrosis.
  exposure: Transient elastography with liver biopsy/reference assessment during alcoholic-patient weaning.
  outcome: transient elastography, liver stiffness, advanced fibrosis, alcohol-related liver disease, diagnostic accuracy
  summary: ClinicalTrials.gov registry context for NCT01789008 describes transient elastography and liver biopsy/reference evaluation in alcoholic patients in weaning; it supports liver-risk measurement context only and has no extracted efficacy result.
  evidenceUse:
  - measurement
  - safety
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
population: Alcoholic patients in weaning/withdrawal being evaluated for alcohol-related liver disease and advanced fibrosis.
interventionOrExposure: Transient elastography with liver biopsy/reference assessment during alcoholic-patient weaning.
comparatorOrControl: Reference fibrosis diagnosis using liver biopsy, according to registry descriptions.
durationOrFollowUp: Registry context; follow-up duration not extracted from the batch materials.
endpoints:
- transient elastography
- liver stiffness
- advanced fibrosis
- alcohol-related liver disease
- diagnostic accuracy
effectEstimatesOrDirection: Registry record only. It describes a proposed evaluation of liver biopsy and transient elastography in 300 alcoholic patients in weaning to test transient-elastography accuracy for excluding severe fibrosis; no registry results were extracted.
adverseEventsOrSafetyNotes: Liver-disease diagnostic context; not an abstinence intervention result and not a wellness-challenge efficacy source.
limitations:
- Registry record rather than results paper.
- No outcome estimates extracted from this source page.
- Alcoholic-patient weaning/liver-disease setting differs from self-directed abstinence challenges.
populationMismatch: Alcoholic patients in weaning/withdrawal with liver-disease evaluation, not low-risk voluntary challengers.
directnessToProtocol: clinical_supervised
claimUseBoundary: context-only. Registry metadata is not an efficacy result and should not support protocol benefit claims.
artifactCandidates:
- art_clinicaltrials_gov_nct01789008_interest_of_transient_elastography_in_2026_04_26
---


This source is included for **Clinical supervised abstinence, AUD detox, and liver-disease biomarker context**.

**Findings:** ClinicalTrials.gov registry context for NCT01789008 describes transient elastography and liver biopsy/reference evaluation in alcoholic patients in weaning; it supports liver-risk measurement context only and has no extracted efficacy result.

**Why it matters:** Registry provenance for liver-stiffness evidence; not direct protocol evidence.

**Potential experiment signals:** transient elastography, liver stiffness, advanced fibrosis, alcohol-related liver disease, diagnostic accuracy.

**Protocol takeaway:** Use only for liver-disease measurement context; do not cite as proof that short abstinence improves liver outcomes.

**Claim use:** `context-only`.
