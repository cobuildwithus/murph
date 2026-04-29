---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-sunlight-exposure-2016-02-09
slug: sources/vitamin-d-supplementation/nice-sunlight-exposure-2016-02-09
title: Sunlight exposure: risks and benefits (NICE guideline NG34)
summary: Sunlight-exposure evidence should stay in a context-only boundary bucket.
status: draft
quality: usable
aliases:
  - Sunlight exposure: risks and benefits (NICE guideline NG34)
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
  canonicalIdBasis: url
  identifiers:
    url: https://www.nice.org.uk/guidance/ng34
  canonicalUrl: https://www.nice.org.uk/guidance/ng34
source:
  kind: guideline
  title: Sunlight exposure: risks and benefits (NICE guideline NG34)
  url: https://www.nice.org.uk/guidance/ng34
  citation: Sunlight exposure: risks and benefits (NICE guideline NG34); https://www.nice.org.uk/guidance/ng34
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: General public and practitioners advising on sunlight exposure
  durationLabel: Guideline published 2016-02-09
  aggregateRole: context
  cohortKey: cohort:nice-sunlight-exposure-2016-02-09
  notes:
    - Evidence bucket: uvb-sunlight-variant-context
    - Directness: safety_boundary; claim use: safety-only; priority: high
    - Candidate row: candidate:adjacent-variants:042; shard: adjacent-variants. Adjacent route/vehicle variant; use only to separate daily oral supplement evidence from UVB/sunlight or fortified-food evidence. Candidate rationale: Professional guideline for UV/sunlight as a vitamin D source and its safety tradeoffs.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:nice-sunlight-exposure-2016-02-09:001
    sourceKey: source_artifact:nice-sunlight-exposure-2016-02-09
    findingKind: other
    population: General public and practitioners advising on sunlight exposure
    exposure: Sunlight/UVB exposure guidance balancing vitamin D generation and skin risks
    outcome: sunlight exposure route — Guideline addresses sunlight/UVB exposure risks and benefits rather than oral daily D3 supplementation.
    summary: Sunlight-exposure evidence should stay in a context-only boundary bucket.
    evidenceUse:
      - safety
---

This source page stores extracted Health Commons evidence for **Sunlight exposure: risks and benefits (NICE guideline NG34)**.

## Evidence role

- Evidence bucket: `uvb-sunlight-variant-context`
- Directness for Daily Vitamin D3 Supplementation: `safety_boundary`
- Protocol claim use: `safety-only`
- Source key: `source_artifact:nice-sunlight-exposure-2016-02-09`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:nice-sunlight-exposure-2016-02-09:001` (other): Sunlight-exposure evidence should stay in a context-only boundary bucket.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
