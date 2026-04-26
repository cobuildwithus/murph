---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01900860-calgary-vitamin-d-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct01900860-calgary-vitamin-d-2026-04-25
title: Dose-dependent Effects of Vitamin D on Bone Health
summary: Calgary registry entry is a high-dose safety/design anchor, not efficacy evidence.
status: draft
quality: usable
aliases:
  - Dose-dependent Effects of Vitamin D on Bone Health
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
    url: https://clinicaltrials.gov/study/NCT01900860
  canonicalUrl: https://clinicaltrials.gov/study/NCT01900860
source:
  kind: web_page
  title: Dose-dependent Effects of Vitamin D on Bone Health
  url: https://clinicaltrials.gov/study/NCT01900860
  citation: Dose-dependent Effects of Vitamin D on Bone Health; https://clinicaltrials.gov/study/NCT01900860
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Healthy adults aged 55 to 70 years
  durationLabel: registry design; duration not extracted from ledger
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct01900860-calgary-vitamin-d-2026-04-25
  notes:
    - Evidence bucket: trial-registry-anchor
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Candidate row: candidate:safety:008; shard: safety. Candidate rationale: Registry record for high-dose daily D3 safety and dose-response trial.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01900860-calgary-vitamin-d-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct01900860-calgary-vitamin-d-2026-04-25
    findingKind: safety
    population: Healthy adults aged 55 to 70 years
    exposure: Vitamin D3 400, 4000, or 10000 IU/day
    outcome: high-dose daily D3 safety and bone endpoints — The registry describes a randomized double-blind comparison of 400, 4000, and 10000 IU/day vitamin D3 with bone density and safety endpoints including hypercalcemia, hypercalciuria, and adverse events; no completed efficacy finding is extracted from the registry record.
    summary: Calgary registry entry is a high-dose safety/design anchor, not efficacy evidence.
    evidenceUse:
      - adjacent_variant
      - safety
---

This source page stores extracted Health Commons evidence for **Dose-dependent Effects of Vitamin D on Bone Health**.

## Evidence role

- Evidence bucket: `trial-registry-anchor`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct01900860-calgary-vitamin-d-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01900860-calgary-vitamin-d-2026-04-25:001` (safety): Calgary registry entry is a high-dose safety/design anchor, not efficacy evidence.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
