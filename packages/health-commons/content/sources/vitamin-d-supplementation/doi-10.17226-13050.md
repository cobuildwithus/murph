---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.17226-13050
slug: sources/vitamin-d-supplementation/doi-10.17226-13050
title: Dietary Reference Intakes for Calcium and Vitamin D
summary: The IOM/NAM reference report supports using 4,000 IU/day as an adult safety boundary while keeping routine supplementation targets lower unless clinically justified.
status: draft
quality: usable
aliases:
  - Dietary Reference Intakes for Calcium and Vitamin D
  - PMID 21796828
  - 10.17226/13050
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
    pmid: '21796828'
    doi: 10.17226/13050
    url: https://pubmed.ncbi.nlm.nih.gov/21796828/
  canonicalUrl: https://pubmed.ncbi.nlm.nih.gov/21796828/
source:
  kind: guideline
  title: Dietary Reference Intakes for Calcium and Vitamin D
  pmid: '21796828'
  doi: 10.17226/13050
  url: https://pubmed.ncbi.nlm.nih.gov/21796828/
  citation: Dietary Reference Intakes for Calcium and Vitamin D; PMID:21796828; DOI:10.17226/13050; https://pubmed.ncbi.nlm.nih.gov/21796828/
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: General adult population reference framework
  durationLabel: Chronic daily intake reference context
  aggregateRole: context
  cohortKey: cohort:doi-10.17226-13050
  notes:
    - Evidence bucket: intake-reference-and-upper-limit
    - Directness: background; claim use: safety-only; priority: backbone
    - Deduped from 3 candidate rows across shards: baseline-status, direct-intervention, safety. Snowball correction: canonical key uses DOI 10.17226/13050; PMID 21796828 retained as metadata only. Candidate rationale: Foundational DRI and safety reference for intake targets, adequacy thresholds, and upper intake boundaries.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.17226-13050:001
    sourceKey: source_artifact:doi-10.17226-13050
    findingKind: intervention_result
    population: General adult population reference framework
    exposure: Vitamin D intake guidance
    outcome: Tolerable upper intake level and routine intake target separation — Adult UL reported as 4,000 IU/day (100 micrograms/day); this is a ceiling, not an efficacy target.
    summary: The IOM/NAM reference report supports using 4,000 IU/day as an adult safety boundary while keeping routine supplementation targets lower unless clinically justified.
    evidenceUse:
      - safety
  -
    findingId: finding:daily-vitamin-d3-supplementation:doi-10.17226-13050:002
    sourceKey: source_artifact:doi-10.17226-13050
    findingKind: other
    population: Population-level guideline users
    exposure: Upper-limit risk assessment
    outcome: Uncertainty in chronic excess-risk evidence — The guideline framework is conservative because chronic high-intake and calcium co-supplementation evidence is limited and partly confounded.
    summary: This source should be used to frame uncertainty around high-dose daily D3 rather than to claim that high daily intake is beneficial or risk-free.
    evidenceUse:
      - safety
---

This source page stores extracted Health Commons evidence for **Dietary Reference Intakes for Calcium and Vitamin D**.

## Evidence role

- Evidence bucket: `intake-reference-and-upper-limit`
- Directness for Daily Vitamin D3 Supplementation: `background`
- Protocol claim use: `safety-only`
- Source key: `source_artifact:doi-10.17226-13050`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:doi-10.17226-13050:001` (intervention_result): The IOM/NAM reference report supports using 4,000 IU/day as an adult safety boundary while keeping routine supplementation targets lower unless clinically justified.
- `finding:daily-vitamin-d3-supplementation:doi-10.17226-13050:002` (other): This source should be used to frame uncertainty around high-dose daily D3 rather than to claim that high daily intake is beneficial or risk-free.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
