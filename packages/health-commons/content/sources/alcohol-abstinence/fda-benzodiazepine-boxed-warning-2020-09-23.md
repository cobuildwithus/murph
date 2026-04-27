---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-benzodiazepine-boxed-warning-2020-09-23
slug: sources/alcohol-abstinence/fda-benzodiazepine-boxed-warning-2020-09-23
title: FDA requiring Boxed Warning updated to improve safe use of benzodiazepine drug class
summary: Regulatory source for benzodiazepine plus alcohol avoidance and taper/withdrawal cautions.
status: draft
quality: usable
aliases:
- source_artifact:fda-benzodiazepine-boxed-warning-2020-09-23
- fda-benzodiazepine-boxed-warning-2020-09-23
- candidate:medications-pregnancy-liver-mental-health:006
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
  title: FDA requiring Boxed Warning updated to improve safe use of benzodiazepine drug class
  authors: U.S. Food and Drug Administration
  year: 2020
  journal: FDA Drug Safety Communication
  citation: U.S. Food and Drug Administration. FDA requiring Boxed Warning updated to improve safe use of benzodiazepine drug class. FDA Drug Safety Communication. 2020
  url: https://www.fda.gov/drugs/drug-safety-and-availability/fda-requiring-boxed-warning-updated-improve-safe-use-benzodiazepine-drug-class
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 8972c6cc6101915902c8ef8b1e84968c72d01343c2cd3b49448a1aaad869285a
    url: https://www.fda.gov/drugs/drug-safety-and-availability/fda-requiring-boxed-warning-updated-improve-safe-use-benzodiazepine-drug-class
  canonicalUrl: https://www.fda.gov/drugs/drug-safety-and-availability/fda-requiring-boxed-warning-updated-improve-safe-use-benzodiazepine-drug-class
researchEvidence:
  designKind: other
  designLabel: Other / registry / case-report context
  populationLabel: Patients taking benzodiazepines
  durationLabel: Regulatory safety communication; no challenge duration.
  aggregateRole: primary
  cohortKey: fda-benzodiazepine-boxed-warning-2020-09-23
  notes:
  - Protocol-specific interpretation belongs to standalone evidence appraisal records, not source-page efficacy fields.
  - Directness and population mismatch are preserved for protocol synthesis.
evidenceBucket: medication, pregnancy, liver disease, and mental-health safety boundary
whyItMatters: Regulatory source for benzodiazepine plus alcohol avoidance and taper/withdrawal cautions.
potentialMurphEndpoints:
- safety
- medication interaction
- mental health boundary
protocolTakeaway: Screen for benzodiazepine use and avoid giving tapering or alcohol co-use advice beyond clinician referral and medication-safety warnings.
murphTakeaway: Screen for benzodiazepine use and avoid giving tapering or alcohol co-use advice beyond clinician referral and medication-safety warnings.
studyDesign: Other / registry / case-report context
modality: Benzodiazepine medication-safety warning
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/fda-benzodiazepine-boxed-warning-2020-09-23
  sourceKey: source_artifact:fda-benzodiazepine-boxed-warning-2020-09-23
  extractedFromArtifactId: art_fda-benzodiazepine-boxed-warning-2020-09-23
  findingKind: safety
  population: Patients taking benzodiazepines
  exposure: Benzodiazepine use, especially with alcohol, opioids, or other CNS depressants; abrupt discontinuation risk
  outcome: safety, medication interaction, mental health boundary
  summary: FDA benzodiazepine boxed-warning communication identifies alcohol co-use and abrupt benzodiazepine discontinuation as safety concerns; this supports medication-interaction and tapering boundaries before abstinence challenges.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Benzodiazepine use, especially with alcohol, opioids, or other CNS depressants; abrupt discontinuation risk
comparatorOrControl: Not applicable.
durationOrFollowUp: Regulatory safety communication; no challenge duration.
endpoints:
- safety
- medication interaction
- mental health boundary
effectEstimatesOrDirection: No challenge efficacy estimate. FDA safety communication supports avoiding alcohol with benzodiazepines and warns about abuse, misuse, addiction, dependence, and withdrawal risk.
adverseEventsOrSafetyNotes: Alcohol with benzodiazepines can increase serious or life-threatening effects; abrupt changes to benzodiazepines require clinician guidance.
limitations:
- Not a direct trial of self-guided 7-, 14-, or 30-day alcohol-free variants.
- Use is limited to safety, clinical context, measurement context, or adjacent-variant interpretation.
populationMismatch: Patients taking benzodiazepines differs from generally healthy community participants considering a short alcohol-free challenge.
directnessToProtocol: clinical_supervised
claimUseBoundary: Safety/context boundary. This source should not be promoted into direct protocol efficacy claims unless a future synthesis explicitly labels it as adjacent evidence.
artifactCandidates:
- art_fda-benzodiazepine-boxed-warning-2020-09-23
---


This source is included for **Medication, pregnancy, liver disease, and mental-health safety boundaries (part 1)**.

**Findings:** FDA benzodiazepine boxed-warning communication identifies alcohol co-use and abrupt benzodiazepine discontinuation as safety concerns; this supports medication-interaction and tapering boundaries before abstinence challenges.

**Why it matters:** Regulatory source for benzodiazepine plus alcohol avoidance and taper/withdrawal cautions.

**Potential experiment signals:** safety, medication interaction, mental health boundary.

**Protocol takeaway:** Screen for benzodiazepine use and avoid giving tapering or alcohol co-use advice beyond clinician referral and medication-safety warnings.

**Claim use:** `safety-only`.
