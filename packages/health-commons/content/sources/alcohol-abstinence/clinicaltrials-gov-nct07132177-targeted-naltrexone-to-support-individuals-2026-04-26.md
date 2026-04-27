---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07132177-targeted-naltrexone-to-support-individuals-2026-04-26
slug: sources/alcohol-abstinence/clinicaltrials-gov-nct07132177-targeted-naltrexone-to-support-individuals-2026-04-26
title: Targeted Naltrexone to Support Individuals Participating in Dry January
summary: ClinicalTrials.gov registry record for targeted naltrexone to support individuals participating in Dry January.
status: draft
quality: usable
aliases:
- Targeted Naltrexone to Support Individuals Participating in Dry January
- NCT07132177
- ClinicalTrials.gov 2026
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
  title: Targeted Naltrexone to Support Individuals Participating in Dry January
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov registry
  citation: ClinicalTrials.gov. Targeted Naltrexone to Support Individuals Participating in Dry January. ClinicalTrials.gov registry 2026. Registry:NCT07132177.
  url: https://clinicaltrials.gov/study/NCT07132177
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT07132177
    titleHash: 2d5c669a73d493132b4a7883798f48631c064e638f2db7adb53cfe26df7602d6
    url: https://clinicaltrials.gov/study/NCT07132177
  canonicalUrl: https://clinicaltrials.gov/study/NCT07132177
  identityAliases:
  - Targeted Naltrexone to Support Individuals Participating in Dry January
  - NCT07132177
  - ClinicalTrials.gov 2026
researchEvidence:
  designKind: expert_protocol
  designLabel: Trial registry record
  populationLabel: People participating in Dry January in a targeted naltrexone support study; enrollment/results not extracted
  durationLabel: Dry January intervention with planned follow-up per registry
  aggregateRole: context
  cohortKey: nct07132177-targeted-naltrexone-dry-january
  notes:
  - source-index.json was absent in the supplied snapshot; identity resolution used the canonical source ledger and fallback content inventory.
  - Unknown or non-person corpus counts were not entered as participantCount to preserve Health Commons contract validity.
evidenceBucket: Dry January and temporary abstinence campaign evidence
whyItMatters: Flags an adjacent medication-supported variant; it has no extracted results and should not be used for efficacy claims.
potentialMurphEndpoints:
- trial registration
- naltrexone support
- Dry January participation
protocolTakeaway: Keep medication-supported Dry January separate from non-medication self-experiment variants.
murphTakeaway: Keep medication-supported Dry January separate from non-medication self-experiment variants.
studyDesign: Clinical trial registry record
modality: Medication-supported Dry January variant
claimUse: context-only
directness: adjacent_variant
participantCountNote: Participant count not extracted or not applicable.
endpoints:
- trial registration
- naltrexone support
- Dry January participation
effectEstimatesOrDirection: The registry describes a medication-supported Dry January variant, but no extracted results are available; it should remain separated from non-medication protocol evidence.
adverseEventsOrSafetyNotes: Medication safety is relevant but no adverse-event results were extracted.
limitations: Registry/protocol record only; no outcome results extracted.
populationMismatch: Medication-supported clinical variant differs from the base non-medication abstinence challenge.
claimUseBoundary: Context-only registry source; no efficacy or safety-result claims.
sourceFindings:
-
  findingId: finding:alcohol-abstinence/batch-002/clinicaltrials-gov-nct07132177-targeted-naltrexone-to-support-individuals-2026-04-26/medication-supported-registry-context
  sourceKey: source_artifact:clinicaltrials-gov-nct07132177-targeted-naltrexone-to-support-individuals-2026-04-26
  extractedFromArtifactId: art_clinicaltrials-gov-nct07132177-targeted-naltrexone-to-support-individuals-2026-04-26_external
  findingKind: context
  population: Dry January participants enrolled or targeted for a naltrexone support study
  exposure: Targeted naltrexone support during Dry January
  outcome: Registered study context
  summary: The registry describes a medication-supported Dry January variant, but no extracted results are available; it should remain separated from non-medication protocol evidence.
  evidenceUse:
  - context
  - safety
murphV1Priority: Medium
pdfRightsStatus: unknown
---


This source is included for **Dry January and temporary abstinence campaign evidence**.

**Findings:**
- The registry describes a medication-supported Dry January variant, but no extracted results are available; it should remain separated from non-medication protocol evidence.

**Why it matters:** Flags an adjacent medication-supported variant; it has no extracted results and should not be used for efficacy claims.

**Potential experiment signals:**
- trial registration
- naltrexone support
- Dry January participation

**Protocol takeaway:** Keep medication-supported Dry January separate from non-medication self-experiment variants.

**Claim use:** `context-only`.
