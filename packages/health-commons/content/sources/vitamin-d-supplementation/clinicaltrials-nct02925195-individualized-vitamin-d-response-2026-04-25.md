---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02925195-individualized-vitamin-d-response-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct02925195-individualized-vitamin-d-response-2026-04-25
title: Individualized Response to Vitamin D Treatment Study
summary: This registry supports response-heterogeneity planning, not a direct protocol effect claim.
status: draft
quality: usable
aliases:
  - Individualized Response to Vitamin D Treatment Study
categories:
  - vitamin-d-supplementation
relations:

  -
    type: related_protocol
    target: protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation
  -
    type: parent_family
    target: experiment_family:vitamin-d-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: https://clinicaltrials.gov/study/NCT02925195
  canonicalUrl: https://clinicaltrials.gov/study/NCT02925195
source:
  kind: web_page
  title: Individualized Response to Vitamin D Treatment Study
  url: https://clinicaltrials.gov/study/NCT02925195
  citation: Individualized Response to Vitamin D Treatment Study; https://clinicaltrials.gov/study/NCT02925195
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Adults enrolled to study modifiers of biologic response to vitamin D3 treatment; detailed eligibility not extracted in this batch
  durationLabel: not extracted
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct02925195-individualized-vitamin-d-response-2026-04-25
  notes:
    - Evidence bucket: trial-registry-anchor
    - Directness: direct_protocol; claim use: context-only; priority: high
    - Candidate row: candidate:population-subgroups:040; shard: population-subgroups. Candidate rationale: Trial registry explicitly designed around individualized response modifiers; useful for recall and provenance.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct02925195-individualized-vitamin-d-response-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct02925195-individualized-vitamin-d-response-2026-04-25
    findingKind: context
    population: Adults enrolled to study modifiers of biologic response to vitamin D3 treatment; detailed eligibility not extracted in this batch
    exposure: Vitamin D3 treatment; dose not extracted from the registry record in this batch
    outcome: response modifiers and biomarker response — The registry objective centers on identifying genetic polymorphisms, clinical characteristics, and biomarkers that modify biologic response to vitamin D3 treatment; no efficacy result is extracted from this registry record.
    summary: This registry supports response-heterogeneity planning, not a direct protocol effect claim.
    evidenceUse:
      - efficacy
---

This source page stores extracted Health Commons evidence for **Individualized Response to Vitamin D Treatment Study**.

## Evidence role

- Evidence bucket: `trial-registry-anchor`
- Directness for Daily Vitamin D3 Supplementation: `direct_protocol`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct02925195-individualized-vitamin-d-response-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct02925195-individualized-vitamin-d-response-2026-04-25:001` (context): This registry supports response-heterogeneity planning, not a direct protocol effect claim.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
