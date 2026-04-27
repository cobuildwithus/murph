---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:pmcid-PMC6711183
slug: sources/alcohol-abstinence/pmcid-PMC6711183
title: 'The Hepatitis C-Alcohol Reduction Treatment (Hep ART) intervention: Study protocol of a multi-center randomized controlled trial'
summary: Protocol paper for the Hep ART liver-focused RCT; useful for design details before extraction.
status: draft
quality: usable
aliases:
- source_artifact:pmcid-PMC6711183
- pmcid-PMC6711183
- PMC6711183
- candidate:alcohol-reduction-comparators:042
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
  kind: journal_article
  title: 'The Hepatitis C-Alcohol Reduction Treatment (Hep ART) intervention: Study protocol of a multi-center randomized controlled trial'
  authors: Proeschold-Bell RJ; et al.
  year: 2018
  journal: Contemporary Clinical Trials
  citation: 'Proeschold-Bell RJ; et al.. The Hepatitis C-Alcohol Reduction Treatment (Hep ART) intervention: Study protocol of a multi-center randomized controlled trial. Contemporary Clinical Trials. 2018. PMCID:PMC6711183.'
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC6711183
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: pmcid
  identifiers:
    pmcid: PMC6711183
    titleHash: 921710072d6fae8443dc721a1fe0f940eeeb42c93dd929be81910e4402e189bd
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC6711183
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC6711183
researchEvidence:
  designKind: other
  designLabel: Other / registry / case-report context
  populationLabel: Adults with hepatitis C and alcohol use
  durationLabel: Multi-center RCT protocol; planned follow-up details belong to the protocol paper and linked trial record.
  aggregateRole: primary
  cohortKey: pmcid-PMC6711183
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Protocol paper for the Hep ART liver-focused RCT; useful for design details before extraction.
potentialMurphEndpoints:
- alcohol intake
- liver enzymes
- adherence
- mood
protocolTakeaway: Use for trial design and endpoint context only; do not cite as treatment result.
murphTakeaway: Use for trial design and endpoint context only; do not cite as treatment result.
studyDesign: Other / registry / case-report context
modality: Hep ART protocol paper
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/pmcid-PMC6711183
  sourceKey: source_artifact:pmcid-PMC6711183
  extractedFromArtifactId: art_pmcid-PMC6711183
  findingKind: context
  population: Adults with hepatitis C and alcohol use
  exposure: Hep ART integrated alcohol reduction intervention protocol
  outcome: alcohol intake, liver enzymes, adherence, mood
  summary: The Hep ART protocol paper is useful for design context for a liver/HCV alcohol-reduction RCT, but it is not an outcome source.
  evidenceUse:
  - adjacent_variant
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
interventionOrExposure: Hep ART integrated alcohol reduction intervention protocol
comparatorOrControl: Integrated alcohol reduction intervention versus enhanced treatment as usual in a trial protocol.
durationOrFollowUp: Multi-center RCT protocol; planned follow-up details belong to the protocol paper and linked trial record.
endpoints:
- alcohol intake
- liver enzymes
- adherence
- mood
effectEstimatesOrDirection: Protocol paper; no outcome results extracted.
adverseEventsOrSafetyNotes: Hepatitis C participants and liver-related endpoints are clinically supervised context.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Adults with hepatitis C and alcohol use differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: clinical_supervised
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_pmcid-PMC6711183
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** The Hep ART protocol paper is useful for design context for a liver/HCV alcohol-reduction RCT, but it is not an outcome source.

**Why it matters:** Protocol paper for the Hep ART liver-focused RCT; useful for design details before extraction.

**Potential experiment signals:** alcohol intake, liver enzymes, adherence, mood.

**Protocol takeaway:** Use for trial design and endpoint context only; do not cite as treatment result.

**Claim use:** `safety-only`.
