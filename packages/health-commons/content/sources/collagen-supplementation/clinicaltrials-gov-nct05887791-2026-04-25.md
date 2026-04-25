---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05887791-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05887791-2026-04-25
title: Collagen Hydrolysate on Postprandial Blood Glucose and Insulin
summary: ClinicalTrials.gov registry for acute metabolic response to collagen hydrolysate.
status: draft
quality: usable
aliases:
- Collagen Hydrolysate on Postprandial Blood Glucose and Insulin
- NCT05887791
categories:
- collagen-supplementation
- metabolic-cardiovascular-adjacent
- adjacent_variant
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT05887791
    url: https://clinicaltrials.gov/study/NCT05887791
  canonicalUrl: https://clinicaltrials.gov/study/NCT05887791
  identityAliases:
  - Collagen Hydrolysate on Postprandial Blood Glucose and Insulin
  - NCT05887791
source:
  kind: web_page
  title: Collagen Hydrolysate on Postprandial Blood Glucose and Insulin
  authors: Rousselot BVBA; BioTeSys GmbH
  citation: ClinicalTrials.gov. Collagen Hydrolysate on Postprandial Blood Glucose and Insulin. NCT05887791. Captured 2026-04-25.
  year: 2023
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05887791
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized double-blind placebo-controlled crossover metabolic trial
  populationLabel: Normoglycemic and prediabetic adults aged 18-70 years.
  durationLabel: Acute postprandial testing; exact sequence duration not fully extracted.
  cohortKey: nct05887791-postprandial-glucose-insulin
  participantCount: 15
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: metabolic-cardiovascular-adjacent
whyItMatters: It captures metabolic glucose/insulin endpoints without treating them as core HCP outcomes.
potentialMurphEndpoints:
- postprandial glucose
- postprandial insulin
- metabolic response
protocolTakeaway: Context-only metabolic registry.
murphTakeaway: Track for metabolic safety/things-to-watch; no registry results available.
studyDesign: trial_registry_randomized_double_blind_crossover_trial
modality: oral collagen hydrolysate doses
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: metabolic-cardiovascular-adjacent
  directness: adjacent_variant
  claimUse: context-only
  priority: low
  batchId: batch-010
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **metabolic-cardiovascular-adjacent**.

## Findings

No results extracted.

## Why it matters

It captures metabolic glucose/insulin endpoints without treating them as core HCP outcomes.

## Potential experiment signals

- postprandial glucose
- postprandial insulin
- metabolic response

## Protocol takeaway

Context-only metabolic registry.

## Safety and adverse events

No safety results extracted.

## Limitations and mismatch

- Registry-only extraction.
- Participant count from indexed registry information.
- Publication match in ledger should be checked during synthesis.
- Metabolic endpoints outside core protocol.
- Population mismatch: Normoglycemic/prediabetic metabolic testing context.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
