---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01942694-d2d-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct01942694-d2d-2026-04-25
title: Vitamin D and Type 2 Diabetes Study (D2d)
summary: D2d is a high-dose disease-specific registry anchor in this batch.
status: draft
quality: usable
aliases:
  - Vitamin D and Type 2 Diabetes Study (D2d)
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
    url: https://clinicaltrials.gov/study/NCT01942694
  canonicalUrl: https://clinicaltrials.gov/study/NCT01942694
source:
  kind: web_page
  title: Vitamin D and Type 2 Diabetes Study (D2d)
  url: https://clinicaltrials.gov/study/NCT01942694
  citation: Vitamin D and Type 2 Diabetes Study (D2d); https://clinicaltrials.gov/study/NCT01942694
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Adults with prediabetes at high risk for type 2 diabetes
  durationLabel: not extracted
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct01942694-d2d-2026-04-25
  notes:
    - Evidence bucket: trial-registry-anchor
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Candidate row: candidate:safety:006; shard: safety. Candidate rationale: Registry anchor for the D2d daily high-dose D3 trial and safety-monitoring context.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01942694-d2d-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct01942694-d2d-2026-04-25
    findingKind: other
    population: Adults with prediabetes at high risk for type 2 diabetes
    exposure: Vitamin D3 4000 IU/day versus placebo
    outcome: trial design and safety monitoring — The registry/protocol anchor describes vitamin D3 4000 IU/day versus placebo in adults with prediabetes, with safety endpoints such as hypercalcemia, kidney stones, kidney function, and adverse events; no completed efficacy result is extracted from this registry record.
    summary: D2d is a high-dose disease-specific registry anchor in this batch.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **Vitamin D and Type 2 Diabetes Study (D2d)**.

## Evidence role

- Evidence bucket: `trial-registry-anchor`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct01942694-d2d-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01942694-d2d-2026-04-25:001` (other): D2d is a high-dose disease-specific registry anchor in this batch.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
