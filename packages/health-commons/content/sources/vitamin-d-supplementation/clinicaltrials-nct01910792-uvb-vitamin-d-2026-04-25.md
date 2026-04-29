---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01910792-uvb-vitamin-d-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct01910792-uvb-vitamin-d-2026-04-25
title: Ultraviolet Light And Vitamin D In Subjects With Fat Malabsorption
summary: Artificial UVB is an adjacent route under study for malabsorption-related vitamin D issues; no efficacy result was extracted from this registry source.
status: draft
quality: usable
aliases:
  - Ultraviolet Light And Vitamin D In Subjects With Fat Malabsorption
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
    url: https://clinicaltrials.gov/study/NCT01910792
  canonicalUrl: https://clinicaltrials.gov/study/NCT01910792
source:
  kind: web_page
  title: Ultraviolet Light And Vitamin D In Subjects With Fat Malabsorption
  url: https://clinicaltrials.gov/study/NCT01910792
  citation: Ultraviolet Light And Vitamin D In Subjects With Fat Malabsorption; https://clinicaltrials.gov/study/NCT01910792
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Subjects with fat malabsorption syndromes or Roux-en-Y gastric bypass context
  durationLabel: not extracted
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct01910792-uvb-vitamin-d-2026-04-25
  notes:
    - Evidence bucket: uvb-sunlight-variant-context
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Candidate row: candidate:adjacent-variants:055; shard: adjacent-variants. Adjacent route/vehicle variant; use only to separate daily oral supplement evidence from UVB/sunlight or fortified-food evidence. Candidate rationale: Registry evidence for UVB as an alternative vitamin D intervention in a malabsorption population mismatch.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01910792-uvb-vitamin-d-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct01910792-uvb-vitamin-d-2026-04-25
    findingKind: other
    population: Subjects with fat malabsorption syndromes or Roux-en-Y gastric bypass context
    exposure: FDA-approved artificial UVB radiation source (Sperti lamp) to raise serum 25(OH)D
    outcome: biomarker:serum-25-oh-vitamin-d, exposure:uvb, safety:uvb-exposure — The registry record describes evaluating an artificial UVB source to improve serum 25(OH)D in people with fat malabsorption or gastric bypass contexts, including interest in skin types II–V. No completed results or effect estimate were extracted.
    summary: Artificial UVB is an adjacent route under study for malabsorption-related vitamin D issues; no efficacy result was extracted from this registry source.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **Ultraviolet Light And Vitamin D In Subjects With Fat Malabsorption**.

## Evidence role

- Evidence bucket: `uvb-sunlight-variant-context`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct01910792-uvb-vitamin-d-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01910792-uvb-vitamin-d-2026-04-25:001` (other): Artificial UVB is an adjacent route under study for malabsorption-related vitamin D issues; no efficacy result was extracted from this registry source.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
