---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06789263-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06789263-2026-04-25
title: Effect of Collagen Hydrolysate on Postprandial Blood Glucose
summary: ClinicalTrials.gov registry for collagen hydrolysate and postprandial glucose/timing effects.
status: draft
quality: usable
aliases:
- Effect of Collagen Hydrolysate on Postprandial Blood Glucose
- NCT06789263
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
    registryId: NCT06789263
    url: https://clinicaltrials.gov/study/NCT06789263
  canonicalUrl: https://clinicaltrials.gov/study/NCT06789263
  identityAliases:
  - Effect of Collagen Hydrolysate on Postprandial Blood Glucose
  - NCT06789263
source:
  kind: web_page
  title: Effect of Collagen Hydrolysate on Postprandial Blood Glucose
  authors: Rousselot BVBA; BioTeSys GmbH
  citation: ClinicalTrials.gov. Effect of Collagen Hydrolysate on Postprandial Blood Glucose. NCT06789263. Captured 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06789263
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized double-blind placebo-controlled crossover metabolic trial
  populationLabel: Normoglycemic and prediabetic adults.
  durationLabel: Acute postprandial testing with timing sub-study.
  cohortKey: nct06789263-postprandial-glucose-timing
  participantCount: 30
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: metabolic-cardiovascular-adjacent
whyItMatters: It flags glucose-response endpoints as adjacent and not core hydrolyzed-collagen efficacy.
potentialMurphEndpoints:
- postprandial glucose
- insulin
- C-peptide
- incretin response
- gastric emptying
protocolTakeaway: Context-only metabolic registry.
murphTakeaway: Meal-timing glucose hypotheses remain unpublished for protocol use.
studyDesign: trial_registry_randomized_double_blind_crossover_trial
modality: oral collagen hydrolysate versus placebo around a mixed meal
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

It flags glucose-response endpoints as adjacent and not core hydrolyzed-collagen efficacy.

## Potential experiment signals

- postprandial glucose
- insulin
- C-peptide
- incretin response
- gastric emptying

## Protocol takeaway

Context-only metabolic registry.

## Safety and adverse events

No safety results extracted.

## Limitations and mismatch

- Registry-only.
- No outcomes available.
- Metabolic endpoint boundary.
- Planned/registered enrollment should be verified against final registry.
- Population mismatch: Normoglycemic/prediabetic metabolic testing context.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
