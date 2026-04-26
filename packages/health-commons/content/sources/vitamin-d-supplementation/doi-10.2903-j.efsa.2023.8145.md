---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.2903-j.efsa.2023.8145
slug: sources/vitamin-d-supplementation/doi-10.2903-j.efsa.2023.8145
title: Scientific opinion on the tolerable upper intake level for vitamin D, including the derivation of a conversion factor for calcidiol monohydrate
summary: EFSA can be used to anchor upper-limit language for daily D3, especially where doses approach 3,200–4,000 IU/day.
status: draft
quality: usable
aliases:
  - Scientific opinion on the tolerable upper intake level for vitamin D, including the derivation of a conversion factor for calcidiol monohydrate
  - PMC10407748
  - 10.2903/j.efsa.2023.8145
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
  identityKind: guideline
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC10407748
    doi: 10.2903/j.efsa.2023.8145
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC10407748/
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC10407748/
source:
  kind: guideline
  title: Scientific opinion on the tolerable upper intake level for vitamin D, including the derivation of a conversion factor for calcidiol monohydrate
  doi: 10.2903/j.efsa.2023.8145
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC10407748/
  citation: Scientific opinion on the tolerable upper intake level for vitamin D, including the derivation of a conversion factor for calcidiol monohydrate; PMCID:PMC10407748; DOI:10.2903/j.efsa.2023.8145; https://pmc.ncbi.nlm.nih.gov/articles/PMC10407748/
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: Regulatory upper-limit population framework
  durationLabel: Chronic daily intake reference context
  aggregateRole: context
  cohortKey: cohort:doi-10.2903-j.efsa.2023.8145
  notes:
    - Evidence bucket: upper-limit-guideline-background
    - Directness: background; claim use: safety-only; priority: backbone
    - Candidate row: candidate:safety:028; shard: safety. Candidate rationale: Recent regulatory upper-limit assessment for vitamin D safety, useful for dose ceiling and monitoring context.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.2903-j.efsa.2023.8145:001
    sourceKey: source_artifact:doi-10.2903-j.efsa.2023.8145
    findingKind: intervention_result
    population: Regulatory upper-limit population framework
    exposure: Vitamin D upper-intake-limit assessment
    outcome: Tolerable upper intake level — Adult upper-limit framing centers on 100 micrograms/day (4,000 IU/day) as a tolerability boundary, not a protocol target.
    summary: EFSA can be used to anchor upper-limit language for daily D3, especially where doses approach 3,200–4,000 IU/day.
    evidenceUse:
      - safety
  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.2903-j.efsa.2023.8145:002
    sourceKey: source_artifact:doi-10.2903-j.efsa.2023.8145
    findingKind: safety
    population: Upper-intake-limit evidence base
    exposure: High vitamin D intake assessment
    outcome: Hypercalcemia and hypercalciuria — Hypercalcemia and hypercalciuria are treated as central adverse endpoints for defining upper-intake boundaries.
    summary: The source supports tracking calcium-related laboratory outcomes when daily D3 protocols approach upper-end dosing.
    evidenceUse:
      - safety
---

This source page stores extracted Health Commons evidence for **Scientific opinion on the tolerable upper intake level for vitamin D, including the derivation of a conversion factor for calcidiol monohydrate**.

## Evidence role

- Evidence bucket: `upper-limit-guideline-background`
- Directness for Daily Vitamin D3 Supplementation: `background`
- Protocol claim use: `safety-only`
- Source key: `source_artifact:doi-10.2903-j.efsa.2023.8145`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:doi-10.2903-j.efsa.2023.8145:001` (intervention_result): EFSA can be used to anchor upper-limit language for daily D3, especially where doses approach 3,200–4,000 IU/day.
- `finding:daily-vitamin-d3-supplementation:doi-10.2903-j.efsa.2023.8145:002` (safety): The source supports tracking calcium-related laboratory outcomes when daily D3 protocols approach upper-end dosing.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
