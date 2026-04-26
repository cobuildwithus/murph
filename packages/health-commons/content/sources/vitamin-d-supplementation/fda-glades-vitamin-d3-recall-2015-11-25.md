---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-glades-vitamin-d3-recall-2015-11-25
slug: sources/vitamin-d-supplementation/fda-glades-vitamin-d3-recall-2015-11-25
title: Glades Drugs Issues Voluntary Nationwide Recall of Compounded Multivitamin Capsules Containing High Amounts of Vitamin D3 (Cholecalciferol)
summary: Manufacturing or compounding errors can create overdose risk that should not be generalized to labeled daily D3 dosing.
status: draft
quality: usable
aliases:
  - Glades Drugs Issues Voluntary Nationwide Recall of Compounded Multivitamin Capsules Containing High Amounts of Vitamin D3 (Cholecalciferol)
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
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/glades-drugs-issues-voluntary-nationwide-recall-compounded-multivitamin-capsules-containing-high
  canonicalUrl: https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/glades-drugs-issues-voluntary-nationwide-recall-compounded-multivitamin-capsules-containing-high
source:
  kind: web_page
  title: Glades Drugs Issues Voluntary Nationwide Recall of Compounded Multivitamin Capsules Containing High Amounts of Vitamin D3 (Cholecalciferol)
  url: https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/glades-drugs-issues-voluntary-nationwide-recall-compounded-multivitamin-capsules-containing-high
  citation: Glades Drugs Issues Voluntary Nationwide Recall of Compounded Multivitamin Capsules Containing High Amounts of Vitamin D3 (Cholecalciferol); https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/glades-drugs-issues-voluntary-nationwide-recall-compounded-multivitamin-capsules-containing-high
researchEvidence:
  designKind: other
  designLabel: other
  populationLabel: Consumers exposed to recalled compounded multivitamin capsules containing high amounts of vitamin D3
  durationLabel: Recall notice dated 2015-11-25; exposure duration not extracted
  aggregateRole: context
  cohortKey: cohort:fda-glades-vitamin-d3-recall-2015-11-25
  notes:
    - Evidence bucket: manufacturing-error-and-toxicity-case-boundary
    - Directness: safety_boundary; claim use: safety-only; priority: high
    - Candidate row: candidate:safety:029; shard: safety. Manufacturing-error/toxicity boundary; not an incidence estimate for normal daily supplement use. Candidate rationale: Regulatory boundary source for overdose and manufacturing/compounding error risk; not protocol-supportive.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:fda-glades-vitamin-d3-recall-2015-11-25:001
    sourceKey: source_artifact:fda-glades-vitamin-d3-recall-2015-11-25
    findingKind: adverse_event
    population: Consumers exposed to recalled compounded multivitamin capsules containing high amounts of vitamin D3
    exposure: Excess vitamin D3 exposure from recalled compounded multivitamin capsules
    outcome: hypercalcemia, kidney failure, soft tissue calcification risk — The recall notice identifies high vitamin D3 exposure from a compounded product as a safety hazard with potential hypercalcemia, kidney failure, and soft tissue calcification.
    summary: Manufacturing or compounding errors can create overdose risk that should not be generalized to labeled daily D3 dosing.
    evidenceUse:
      - safety
---

This source page stores extracted Health Commons evidence for **Glades Drugs Issues Voluntary Nationwide Recall of Compounded Multivitamin Capsules Containing High Amounts of Vitamin D3 (Cholecalciferol)**.

## Evidence role

- Evidence bucket: `manufacturing-error-and-toxicity-case-boundary`
- Directness for Daily Vitamin D3 Supplementation: `safety_boundary`
- Protocol claim use: `safety-only`
- Source key: `source_artifact:fda-glades-vitamin-d3-recall-2015-11-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:fda-glades-vitamin-d3-recall-2015-11-25:001` (adverse_event): Manufacturing or compounding errors can create overdose risk that should not be generalized to labeled daily D3 dosing.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
