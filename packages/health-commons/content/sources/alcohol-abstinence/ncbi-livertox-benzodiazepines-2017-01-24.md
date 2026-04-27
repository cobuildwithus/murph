---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ncbi-livertox-benzodiazepines-2017-01-24
slug: sources/alcohol-abstinence/ncbi-livertox-benzodiazepines-2017-01-24
title: Benzodiazepines
summary: Medication safety reference for benzodiazepines in liver-related risk screening.
status: draft
quality: usable
aliases:
- source_artifact:ncbi-livertox-benzodiazepines-2017-01-24
- ncbi-livertox-benzodiazepines-2017-01-24
- candidate:medications-pregnancy-liver-mental-health:036
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
  kind: web_page
  title: Benzodiazepines
  authors: National Institute of Diabetes and Digestive and Kidney Diseases
  year: 2017
  journal: 'LiverTox: Clinical and Research Information on Drug-Induced Liver Injury; NCBI Bookshelf'
  citation: 'National Institute of Diabetes and Digestive and Kidney Diseases. Benzodiazepines. LiverTox: Clinical and Research Information on Drug-Induced Liver Injury; NCBI Bookshelf. 2017'
  url: https://www.ncbi.nlm.nih.gov/books/NBK548298
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 2b2597ab834105ee18eeccb229483d98b0351657034e763e5dd80b3ba6027d6d
    url: https://www.ncbi.nlm.nih.gov/books/NBK548298
  canonicalUrl: https://www.ncbi.nlm.nih.gov/books/NBK548298
researchEvidence:
  designKind: other
  designLabel: Other / registry / case-report context
  populationLabel: Patients exposed to benzodiazepines where liver injury is a concern
  durationLabel: NCBI Bookshelf drug monograph; no challenge duration.
  aggregateRole: primary
  cohortKey: ncbi-livertox-benzodiazepines-2017-01-24
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Medication safety reference for benzodiazepines in liver-related risk screening.
potentialMurphEndpoints:
- safety
- medication interaction
- liver disease boundary
protocolTakeaway: Use as medication/liver safety context only.
murphTakeaway: Use as medication/liver safety context only.
studyDesign: Other / registry / case-report context
modality: Benzodiazepine liver-safety monograph
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/ncbi-livertox-benzodiazepines-2017-01-24
  sourceKey: source_artifact:ncbi-livertox-benzodiazepines-2017-01-24
  extractedFromArtifactId: art_ncbi-livertox-benzodiazepines-2017-01-24
  findingKind: safety
  population: Patients exposed to benzodiazepines where liver injury is a concern
  exposure: Benzodiazepine exposure and drug-induced liver injury context
  outcome: safety, medication interaction, liver disease boundary
  summary: LiverTox benzodiazepines content supports medication and liver-safety context when alcohol abstinence content addresses benzodiazepine users or liver concerns.
  evidenceUse:
  - safety
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
interventionOrExposure: Benzodiazepine exposure and drug-induced liver injury context
comparatorOrControl: Not applicable.
durationOrFollowUp: NCBI Bookshelf drug monograph; no challenge duration.
endpoints:
- safety
- medication interaction
- liver disease boundary
effectEstimatesOrDirection: No challenge efficacy estimate. LiverTox provides drug-induced liver injury context for benzodiazepine exposure.
adverseEventsOrSafetyNotes: Benzodiazepine exposure and liver-disease context should be handled with medication review rather than user-directed medication advice.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Patients exposed to benzodiazepines where liver injury is a concern differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: clinical_supervised
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_ncbi-livertox-benzodiazepines-2017-01-24
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** LiverTox benzodiazepines content supports medication and liver-safety context when alcohol abstinence content addresses benzodiazepine users or liver concerns.

**Why it matters:** Medication safety reference for benzodiazepines in liver-related risk screening.

**Potential experiment signals:** safety, medication interaction, liver disease boundary.

**Protocol takeaway:** Use as medication/liver safety context only.

**Claim use:** `safety-only`.
