---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07229014-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct07229014-2026-04-25
title: Hydrolysed Collagen Peptide Supplementation for Quality of Life, Appetite, Mood, and Energy
summary: ClinicalTrials.gov registry for short-term collagen supplement effects on QoL/appetite/mood/energy and glucose.
status: draft
quality: usable
aliases:
- Hydrolysed Collagen Peptide Supplementation for Quality of Life, Appetite, Mood, and Energy
- NCT07229014
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
    registryId: NCT07229014
    url: https://clinicaltrials.gov/study/NCT07229014
  canonicalUrl: https://clinicaltrials.gov/study/NCT07229014
  identityAliases:
  - Hydrolysed Collagen Peptide Supplementation for Quality of Life, Appetite, Mood, and Energy
  - NCT07229014
source:
  kind: web_page
  title: Hydrolysed Collagen Peptide Supplementation for Quality of Life, Appetite, Mood, and Energy
  authors: King's College London
  citation: ClinicalTrials.gov. Hydrolysed Collagen Peptide Supplementation for Quality of Life, Appetite, Mood, and Energy. NCT07229014. Captured 2026-04-25.
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT07229014
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized trial of collagen supplement for patient-reported and glycemic endpoints
  populationLabel: Adults aged 18-65 years with overweight or obesity and perceived low quality of life.
  durationLabel: 8 days per condition/exposure in accessible registry summaries.
  cohortKey: nct07229014-quality-life-appetite-glycemic
  aggregateRole: primary
evidenceBucket: metabolic-cardiovascular-adjacent
whyItMatters: It helps avoid accidentally elevating broad wellness outcomes without data.
potentialMurphEndpoints:
- quality of life
- appetite
- mood
- energy
- continuous glucose
protocolTakeaway: Registry context only.
murphTakeaway: Broad subjective endpoints are being studied, but no findings are available here.
studyDesign: trial_registry_randomized_trial
modality: hydrolysed collagen peptide supplement versus placebo
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

It helps avoid accidentally elevating broad wellness outcomes without data.

## Potential experiment signals

- quality of life
- appetite
- mood
- energy
- continuous glucose

## Protocol takeaway

Registry context only.

## Safety and adverse events

Tolerability planned; no results extracted.

## Limitations and mismatch

- Registry-only.
- Participant count not verified.
- Short exposure.
- Broad wellness endpoints outside core protocol claims.
- Population mismatch: Overweight/obesity QoL/appetite context rather than core collagen outcome population.

## Claim use

`context-only`. This source should remain in its assigned evidence bucket and should not be promoted into direct Hydrolyzed Collagen Peptides protocol synthesis unless a later synthesis step explicitly resolves directness and endpoint scope.
