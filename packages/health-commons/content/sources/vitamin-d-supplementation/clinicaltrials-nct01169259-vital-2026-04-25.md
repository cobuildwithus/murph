---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01169259-vital-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct01169259-vital-2026-04-25
title: Vitamin D and Omega-3 Trial (VITAL)
summary: VITAL is a direct daily-D3 registry anchor, but the registry page is context-only in this extraction.
status: draft
quality: usable
aliases:
  - Vitamin D and Omega-3 Trial (VITAL)
categories:
  - vitamin-d-supplementation
relations:
  -
    type: related_protocol
    target: protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation
  -
    type: parent_family
    target: experiment_family:vitamin-d-supplementation
  -
    type: same_work_as
    target: source_artifact:clinicaltrials-nct01169259-2026-04-25
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: https://clinicaltrials.gov/study/NCT01169259
  canonicalUrl: https://clinicaltrials.gov/study/NCT01169259
source:
  kind: web_page
  title: Vitamin D and Omega-3 Trial (VITAL)
  url: https://clinicaltrials.gov/study/NCT01169259
  citation: Vitamin D and Omega-3 Trial (VITAL); https://clinicaltrials.gov/study/NCT01169259
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: U.S. community-dwelling adult men and women in a primary-prevention trial
  durationLabel: multi-year prevention trial
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct01169259-vital-2026-04-25
  notes:
    - Evidence bucket: trial-registry-anchor
    - Directness: direct_protocol; claim use: context-only; priority: high
    - Deduped from 3 candidate rows across shards: baseline-status, direct-intervention, safety. Candidate rationale: Registry anchor for VITAL and its major daily D3 ancillary outcomes.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01169259-vital-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct01169259-vital-2026-04-25
    findingKind: other
    population: U.S. community-dwelling adult men and women in a primary-prevention trial
    exposure: Vitamin D3 2000 IU/day versus placebo with factorial omega-3 assignment
    outcome: trial design and registry provenance — The registry records a daily vitamin D3 2000 IU/day versus placebo factorial prevention trial with safety monitoring; no completed efficacy result is extracted from the registry record in this batch.
    summary: VITAL is a direct daily-D3 registry anchor, but the registry page is context-only in this extraction.
    evidenceUse:
      - efficacy
---

This source page stores extracted Health Commons evidence for **Vitamin D and Omega-3 Trial (VITAL)**.

## Evidence role

- Evidence bucket: `trial-registry-anchor`
- Directness for Daily Vitamin D3 Supplementation: `direct_protocol`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct01169259-vital-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01169259-vital-2026-04-25:001` (other): VITAL is a direct daily-D3 registry anchor, but the registry page is context-only in this extraction.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
