---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06061315-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06061315-2026-04-25
title: Effect of Collagen Peptides, in Combination With Resistance Training, on Body Composition and Muscle Strength in Untrained Men
summary: ClinicalTrials.gov registry for collagen peptides combined with resistance training.
status: draft
quality: usable
aliases:
- Effect of Collagen Peptides, in Combination With Resistance Training, on Body Composition and Muscle Strength in Untrained Men
- NCT06061315
categories:
- collagen-supplementation
- metabolic-cardiovascular-adjacent
- direct_protocol
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
    registryId: NCT06061315
    url: https://clinicaltrials.gov/study/NCT06061315
  canonicalUrl: https://clinicaltrials.gov/study/NCT06061315
  identityAliases:
  - Effect of Collagen Peptides, in Combination With Resistance Training, on Body Composition and Muscle Strength in Untrained Men
  - NCT06061315
source:
  kind: web_page
  title: Effect of Collagen Peptides, in Combination With Resistance Training, on Body Composition and Muscle Strength in Untrained Men
  authors: University of Southern Denmark
  citation: ClinicalTrials.gov. Effect of Collagen Peptides, in Combination With Resistance Training, on Body Composition and Muscle Strength in Untrained Men. NCT06061315. Captured 2026-04-25.
  year: 2023
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06061315
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized trial of collagen peptides plus resistance training
  populationLabel: Untrained overweight men aged 30-60 years.
  durationLabel: 12 weeks of supervised resistance training planned.
  cohortKey: nct06061315-resistance-training-men
  participantCount: 80
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: metabolic-cardiovascular-adjacent
whyItMatters: It is close to body-composition/strength questions but cannot be used until results are available.
potentialMurphEndpoints:
- lean mass
- maximal strength
- explosive strength
- fat mass
- resting metabolism
protocolTakeaway: Registry watchlist only; no outcome claim.
murphTakeaway: Good candidate for future direct evidence, but current extraction has no results.
studyDesign: trial_registry_randomized_controlled_trial
modality: collagen peptides plus supervised resistance training
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: metabolic-cardiovascular-adjacent
  directness: direct_protocol
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

It is close to body-composition/strength questions but cannot be used until results are available.

## Potential experiment signals

- lean mass
- maximal strength
- explosive strength
- fat mass
- resting metabolism

## Protocol takeaway

Registry watchlist only; no outcome claim.

## Safety and adverse events

No safety results extracted.

## Limitations and mismatch

- Registry-only.
- Planned/registered count.
- Exercise co-intervention.
- No published result located in this extraction.
- Population mismatch: Untrained overweight men with resistance training; not standalone HCP use.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
