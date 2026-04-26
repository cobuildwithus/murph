---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02387892-fortified-cheese-yogurt-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct02387892-fortified-cheese-yogurt-2026-04-25
title: Fortified Cheese and Yogurt Products and Vitamin D Status
summary: Fortified cheese/yogurt in children is adjacent food-route evidence with a population mismatch and no extracted registry result.
status: draft
quality: usable
aliases:
  - Fortified Cheese and Yogurt Products and Vitamin D Status
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
    url: https://clinicaltrials.gov/study/NCT02387892
  canonicalUrl: https://clinicaltrials.gov/study/NCT02387892
source:
  kind: web_page
  title: Fortified Cheese and Yogurt Products and Vitamin D Status
  url: https://clinicaltrials.gov/study/NCT02387892
  citation: Fortified Cheese and Yogurt Products and Vitamin D Status; https://clinicaltrials.gov/study/NCT02387892
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Children consuming fortified cheese and yogurt products
  durationLabel: not extracted
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct02387892-fortified-cheese-yogurt-2026-04-25
  notes:
    - Evidence bucket: fortified-food-variant-context
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Candidate row: candidate:adjacent-variants:058; shard: adjacent-variants. Adjacent route/vehicle variant; use only to separate daily oral supplement evidence from UVB/sunlight or fortified-food evidence. Candidate rationale: Registry record for fortified dairy products in children; useful as population-mismatch source if child fortification literature is scoped.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct02387892-fortified-cheese-yogurt-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct02387892-fortified-cheese-yogurt-2026-04-25
    findingKind: other
    population: Children consuming fortified cheese and yogurt products
    exposure: Vitamin D-fortified cheese and yogurt products
    outcome: biomarker:serum-25-oh-vitamin-d, diet:fortified-yogurt, diet:fortified-cheese, outcome:vitamin-d-intake — The registry record states that the study tested whether adding vitamin D to cheese and yogurt products would help children improve vitamin D intake. No registry-posted result or effect estimate was extracted for this batch.
    summary: Fortified cheese/yogurt in children is adjacent food-route evidence with a population mismatch and no extracted registry result.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **Fortified Cheese and Yogurt Products and Vitamin D Status**.

## Evidence role

- Evidence bucket: `fortified-food-variant-context`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct02387892-fortified-cheese-yogurt-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct02387892-fortified-cheese-yogurt-2026-04-25:001` (other): Fortified cheese/yogurt in children is adjacent food-route evidence with a population mismatch and no extracted registry result.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
