---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02166333-sturdy-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct02166333-sturdy-2026-04-25
title: Study To Understand Fall Reduction and Vitamin D in You (STURDY)
summary: STURDY is a registry/design anchor for fall-dose questions, not a completed effect estimate.
status: draft
quality: usable
aliases:
  - Study To Understand Fall Reduction and Vitamin D in You (STURDY)
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
    url: https://clinicaltrials.gov/study/NCT02166333
  canonicalUrl: https://clinicaltrials.gov/study/NCT02166333
source:
  kind: web_page
  title: Study To Understand Fall Reduction and Vitamin D in You (STURDY)
  url: https://clinicaltrials.gov/study/NCT02166333
  citation: Study To Understand Fall Reduction and Vitamin D in You (STURDY); https://clinicaltrials.gov/study/NCT02166333
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Older adults with elevated fall risk and low 25(OH)D context in trial-design literature
  durationLabel: not extracted
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct02166333-sturdy-2026-04-25
  notes:
    - Evidence bucket: trial-registry-anchor
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Deduped from 2 candidate rows across shards: direct-intervention, safety. Candidate rationale: Registry anchor for the STURDY dose-finding fall-prevention trial.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct02166333-sturdy-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct02166333-sturdy-2026-04-25
    findingKind: other
    population: Older adults with elevated fall risk and low 25(OH)D context in trial-design literature
    exposure: Daily vitamin D3 dose arms including 200, 1000, 2000, and 4000 IU/day
    outcome: fall-prevention dose-finding design — The registry describes daily vitamin D3 dose arms of 200, 1000, 2000, and 4000 IU/day in older adults with elevated fall risk, with fall and safety endpoints; no completed efficacy result is extracted from the registry record.
    summary: STURDY is a registry/design anchor for fall-dose questions, not a completed effect estimate.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **Study To Understand Fall Reduction and Vitamin D in You (STURDY)**.

## Evidence role

- Evidence bucket: `trial-registry-anchor`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct02166333-sturdy-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct02166333-sturdy-2026-04-25:001` (other): STURDY is a registry/design anchor for fall-dose questions, not a completed effect estimate.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
