---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
slug: sources/alcohol-abstinence/clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
title: Hepatitis C Alcohol Reduction Treatment (Hep ART)
summary: Registry companion for Hep ART trial; useful for trial design and outcomes metadata.
status: draft
quality: usable
aliases:
- source_artifact:clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
- clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
- NCT02176980
- candidate:alcohol-reduction-comparators:070
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
  title: Hepatitis C Alcohol Reduction Treatment (Hep ART)
  authors: Duke University / ClinicalTrials.gov record
  year: 2024
  journal: ClinicalTrials.gov
  citation: Duke University / ClinicalTrials.gov record. Hepatitis C Alcohol Reduction Treatment (Hep ART). ClinicalTrials.gov. 2024. Registry:NCT02176980.
  url: https://clinicaltrials.gov/study/NCT02176980
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT02176980
    titleHash: d0e74129fe3c528bf68020226911c032ba5e0dc873bdc88c47aaa6acb7102894
    url: https://clinicaltrials.gov/study/NCT02176980
  canonicalUrl: https://clinicaltrials.gov/study/NCT02176980
researchEvidence:
  designKind: other
  designLabel: Other / registry / case-report context
  populationLabel: Adults with hepatitis C and alcohol use
  durationLabel: Trial registry context; duration and results should be taken from the registry/publications before quantitative use.
  aggregateRole: primary
  cohortKey: clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Registry companion for Hep ART trial; useful for trial design and outcomes metadata.
potentialMurphEndpoints:
- alcohol intake
- liver enzymes
- adherence
- mood
protocolTakeaway: Use only as registry context linked to Hep ART sources; do not cite as outcome evidence.
murphTakeaway: Use only as registry context linked to Hep ART sources; do not cite as outcome evidence.
studyDesign: Other / registry / case-report context
modality: Hep ART ClinicalTrials.gov registry context
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
  sourceKey: source_artifact:clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
  extractedFromArtifactId: art_clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
  findingKind: context
  population: Adults with hepatitis C and alcohol use
  exposure: Hep ART alcohol reduction intervention
  outcome: alcohol intake, liver enzymes, adherence, mood
  summary: The Hep ART registry record supplies design and outcome context for an alcohol-reduction intervention in hepatitis C, but registry metadata alone should not be used as efficacy evidence.
  evidenceUse:
  - adjacent_variant
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
interventionOrExposure: Hep ART alcohol reduction intervention
comparatorOrControl: Registry comparator metadata not extracted in this batch.
durationOrFollowUp: Trial registry context; duration and results should be taken from the registry/publications before quantitative use.
endpoints:
- alcohol intake
- liver enzymes
- adherence
- mood
effectEstimatesOrDirection: ClinicalTrials.gov registry record; no outcome result extracted for source-owned findings.
adverseEventsOrSafetyNotes: Hepatitis C/liver context is clinically supervised and population-mismatched to general challenge users.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Adults with hepatitis C and alcohol use differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: clinical_supervised
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_clinicaltrials-gov-nct02176980-hepatitis-c-alcohol-reduction-treatment-2026-04-26
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** The Hep ART registry record supplies design and outcome context for an alcohol-reduction intervention in hepatitis C, but registry metadata alone should not be used as efficacy evidence.

**Why it matters:** Registry companion for Hep ART trial; useful for trial design and outcomes metadata.

**Potential experiment signals:** alcohol intake, liver enzymes, adherence, mood.

**Protocol takeaway:** Use only as registry context linked to Hep ART sources; do not cite as outcome evidence.

**Claim use:** `safety-only`.
