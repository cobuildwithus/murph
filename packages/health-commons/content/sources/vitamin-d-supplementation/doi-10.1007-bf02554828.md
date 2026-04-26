---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007-bf02554828
slug: sources/vitamin-d-supplementation/doi-10.1007-bf02554828
title: Prevention of hypovitaminosis D in the elderly
summary: The ledger identifies this as a daily cholecalciferol elderly-maintenance/washout source, but exact dose, duration, n, and effect estimates were not extracted.
status: draft
quality: usable
aliases:
  - Prevention of hypovitaminosis D in the elderly
  - 10.1007/bf02554828
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
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1007/bf02554828
    url: https://doi.org/10.1007/BF02554828
  canonicalUrl: https://doi.org/10.1007/BF02554828
source:
  kind: journal_article
  title: Prevention of hypovitaminosis D in the elderly
  doi: 10.1007/bf02554828
  url: https://doi.org/10.1007/BF02554828
  citation: Prevention of hypovitaminosis D in the elderly; DOI:10.1007/bf02554828; https://doi.org/10.1007/BF02554828
researchEvidence:
  designKind: controlled_trial
  designLabel: supplementation_trial
  populationLabel: Elderly adults
  durationLabel: not extracted
  aggregateRole: context
  cohortKey: cohort:doi-10.1007-bf02554828
  notes:
    - Evidence bucket: direct-daily-d3-protocol-context
    - Directness: direct_protocol; claim use: context-only; priority: high
    - Candidate row: candidate:snowball-gap-fill:008; shard: 10-snowball-gap-fill. Candidate rationale: Snowball source for maintenance and withdrawal timing; DOI-only key required.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.1007-bf02554828:001
    sourceKey: source_artifact:doi-10.1007-bf02554828
    findingKind: other
    population: Elderly adults
    exposure: Daily cholecalciferol; dose not extracted from available batch materials
    outcome: Maintenance and withdrawal evidence — The ledger identifies this as a daily cholecalciferol elderly-maintenance/washout source, but exact dose, duration, n, and effect estimates were not extracted.
    summary: The ledger identifies this as a daily cholecalciferol elderly-maintenance/washout source, but exact dose, duration, n, and effect estimates were not extracted.
    evidenceUse:
      - efficacy
---

This source page stores extracted Health Commons evidence for **Prevention of hypovitaminosis D in the elderly**.

## Evidence role

- Evidence bucket: `direct-daily-d3-protocol-context`
- Directness for Daily Vitamin D3 Supplementation: `direct_protocol`
- Protocol claim use: `context-only`
- Source key: `source_artifact:doi-10.1007-bf02554828`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:doi-10.1007-bf02554828:001` (other): The ledger identifies this as a daily cholecalciferol elderly-maintenance/washout source, but exact dose, duration, n, and effect estimates were not extracted.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
