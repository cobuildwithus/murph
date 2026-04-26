---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25
slug: sources/vitamin-d-supplementation/clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25
title: A Single Wintertime Dose of Vitamin D3 to Prevent Winter Decline in Vitamin D Status in Healthy Adults
summary: The registry defines a single high-dose D3 bolus schedule, not a daily supplementation protocol.
status: draft
quality: usable
aliases:
  - A Single Wintertime Dose of Vitamin D3 to Prevent Winter Decline in Vitamin D Status in Healthy Adults
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
    url: https://clinicaltrials.gov/study/NCT01924910
  canonicalUrl: https://clinicaltrials.gov/study/NCT01924910
source:
  kind: web_page
  title: A Single Wintertime Dose of Vitamin D3 to Prevent Winter Decline in Vitamin D Status in Healthy Adults
  url: https://clinicaltrials.gov/study/NCT01924910
  citation: A Single Wintertime Dose of Vitamin D3 to Prevent Winter Decline in Vitamin D Status in Healthy Adults; https://clinicaltrials.gov/study/NCT01924910
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: Healthy adults in a registered wintertime vitamin D3 bolus trial
  durationLabel: Single-dose wintertime trial; exact follow-up window not fully extracted from registry record
  aggregateRole: context
  cohortKey: cohort:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25
  notes:
    - Evidence bucket: trial-registry-anchor
    - Directness: adjacent_variant; claim use: context-only; priority: medium
    - Candidate row: candidate:adjacent-variants:054; shard: adjacent-variants. Candidate rationale: Registry record for a single-bolus winter trial; useful for matching published bolus reports and checking protocol details.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25:001
    sourceKey: source_artifact:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25
    findingKind: intervention_result
    population: Healthy adults in a registered wintertime vitamin D3 bolus trial
    exposure: Single 250,000 IU oral vitamin D3 dose before winter
    outcome: Registry protocol schedule and vitamin D status endpoints — Registry-only dose/schedule detail; no efficacy result extracted from this source record.
    summary: The registry defines a single high-dose D3 bolus schedule, not a daily supplementation protocol.
    evidenceUse:
      - adjacent_variant
  -
    findingId: finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25:002
    sourceKey: source_artifact:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25
    findingKind: other
    population: Healthy adults in a single-bolus registry trial
    exposure: Single wintertime vitamin D3 bolus
    outcome: Protocol-to-daily-D3 applicability — The single-bolus schedule is adjacent and should not be promoted into daily D3 claims.
    summary: Use only to anchor the published bolus source and preserve schedule boundary.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **A Single Wintertime Dose of Vitamin D3 to Prevent Winter Decline in Vitamin D Status in Healthy Adults**.

## Evidence role

- Evidence bucket: `trial-registry-anchor`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25:001` (intervention_result): The registry defines a single high-dose D3 bolus schedule, not a daily supplementation protocol.
- `finding:daily-vitamin-d3-supplementation:clinicaltrials-nct01924910-vitamin-d3-bolus-2026-04-25:002` (other): Use only to anchor the published bolus source and preserve schedule boundary.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
