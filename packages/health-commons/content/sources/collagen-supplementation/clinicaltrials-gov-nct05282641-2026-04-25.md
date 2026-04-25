---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05282641-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05282641-2026-04-25
title: ClinicalTrials.gov registration for porcine-derived collagen hydrolysates and blood-pressure/cardiometabolic outcomes
summary: ClinicalTrials.gov registration for porcine-derived collagen hydrolysate and cardiometabolic endpoints.
status: draft
quality: usable
aliases:
- ClinicalTrials.gov registration for porcine-derived collagen hydrolysates and blood-pressure/cardiometabolic outcomes
- NCT05282641
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
    registryId: NCT05282641
    url: https://clinicaltrials.gov/study/NCT05282641
  canonicalUrl: https://clinicaltrials.gov/study/NCT05282641
  identityAliases:
  - ClinicalTrials.gov registration for porcine-derived collagen hydrolysates and blood-pressure/cardiometabolic outcomes
  - NCT05282641
source:
  kind: web_page
  title: ClinicalTrials.gov registration for porcine-derived collagen hydrolysates and blood-pressure/cardiometabolic outcomes
  authors: ClinicalTrials.gov; Maastricht University-related investigators
  citation: ClinicalTrials.gov. ClinicalTrials.gov registration for porcine-derived collagen hydrolysates and blood-pressure/cardiometabolic outcomes. NCT05282641. Captured 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05282641
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized controlled trial linked to published cardiometabolic/blood-pressure results
  populationLabel: Middle-aged and older adults with overweight or obesity.
  durationLabel: 2-week run-in followed by 4-week intervention in linked publication.
  cohortKey: nct05282641-porcine-collagen-bp-registry
  participantCount: 56
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: metabolic-cardiovascular-adjacent
whyItMatters: It documents registration and endpoint planning for the published null cardiometabolic trial.
potentialMurphEndpoints:
- blood pressure
- endothelial dysfunction
- inflammation
- retinal vasculature
- cognition
protocolTakeaway: Use as registry cross-reference only.
murphTakeaway: The trial is represented by both registry and publication; outcome extraction should cite the publication.
studyDesign: trial_registry_randomized_controlled_trial
modality: porcine-derived collagen hydrolysate
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

No separate registry results extracted; linked publication reports no clear cardiometabolic advantage.

## Why it matters

It documents registration and endpoint planning for the published null cardiometabolic trial.

## Potential experiment signals

- blood pressure
- endothelial dysfunction
- inflammation
- retinal vasculature
- cognition

## Protocol takeaway

Use as registry cross-reference only.

## Safety and adverse events

No registry safety results extracted.

## Limitations and mismatch

- Registry cross-reference.
- Do not duplicate published outcome findings.
- Publication should anchor effect claims.
- Population mismatch: Cardiometabolic overweight/obesity context.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
