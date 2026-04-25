---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct07157241-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct07157241-2026-04-25
title: The Effect of Omega-3 Supplements on Stress, Anxiety, Depression, Memory and Sleep Quality
summary: ClinicalTrials.gov record apparently linked to the retracted psychological-distress omega-3 trial. Track as do-not-use provenance, not as protocol evidence.
status: draft
quality: stub
aliases:
- clinicaltrials-nct07157241-2026-04-25
- NCT07157241
categories:
- omega-3-supplementation
- mood-cognition
- do-not-use
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT07157241
    url: https://clinicaltrials.gov/study/NCT07157241
  canonicalUrl: https://clinicaltrials.gov/study/NCT07157241
  identityAliases:
  - NCT07157241
sourceKind: trial_registry
directnessToProtocol: direct_protocol
source:
  kind: web_page
  title: The Effect of Omega-3 Supplements on Stress, Anxiety, Depression, Memory and Sleep Quality
  authors: ClinicalTrials.gov record
  year: 2025
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. The Effect of Omega-3 Supplements on Stress, Anxiety, Depression, Memory and Sleep Quality. NCT07157241.
  url: https://clinicaltrials.gov/study/NCT07157241
researchEvidence:
  designKind: other
  designLabel: Clinical trial registry record linked to excluded/retracted evidence
  populationLabel: Individuals with psychological distress
  durationLabel: Not extracted; excluded before source extraction.
  aggregateRole: context
  cohortKey: clinicaltrials-nct07157241-retracted-link
  notes:
  - Evidence bucket: mood_cognition
  - Ledger directness: direct_protocol
  - Ledger claim use: do-not-use
  - Ledger priority: exclude
evidenceBucket: mood_cognition
whyItMatters: Retained only to document a registry record apparently linked to the retracted psychological-distress trial.
potentialMurphEndpoints:
- stress
- anxiety
- depression
- memory
- sleep quality
protocolTakeaway: Do not use this registry record for protocol claims without independent verification and extracted non-retracted results.
murphTakeaway: Registry provenance only.
studyDesign: Clinical trial registry record
modality: Omega-3 supplements versus placebo
claimUse: do-not-use
directness: direct_protocol
murphV1Priority: exclude
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: mood_cognition
  directness: direct_protocol
  claimUse: do-not-use
  priority: exclude
  batchId: excluded-not-extracted
  needsArtifactManifestEntry: true
  artifactRightsStatusGuess: unknown
---

## Quick read

- **Ledger role:** do-not-use / direct_protocol.
- **Evidence bucket:** mood_cognition.
- **Study design label:** clinical trial registry record linked to excluded evidence.
- **Priority:** exclude.

## Murph use

Keep this page only for provenance and retraction-boundary tracking. It should not support omega-3 mood, anxiety, sleep, cognition, or general wellness claims.

## Rights-safe handling

This page is metadata and synthesis only. It does not include copyrighted full text. Store or redistribute PDFs only after separate rights, license, hash, and storage review.
