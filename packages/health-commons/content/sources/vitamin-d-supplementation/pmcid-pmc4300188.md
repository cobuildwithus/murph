---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:pmcid-PMC4300188
slug: sources/vitamin-d-supplementation/pmcid-pmc4300188
title: A Meta-Analysis of High Dose, Intermittent Vitamin D Supplementation among Older Adults
summary: The meta-analysis found no overall protective effect of high-dose intermittent vitamin D on mortality, fracture, or falls outcomes.
status: draft
quality: usable
aliases:
  - A Meta-Analysis of High Dose, Intermittent Vitamin D Supplementation among Older Adults
  - PMC4300188
  - source_artifact:pmcid-PMC4300188
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
  canonicalIdBasis: pmcid
  identifiers:
    pmcid: PMC4300188
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC4300188/
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC4300188/
  identityAliases:
    - source_artifact:pmcid-PMC4300188
source:
  kind: review
  title: A Meta-Analysis of High Dose, Intermittent Vitamin D Supplementation among Older Adults
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC4300188/
  citation: A Meta-Analysis of High Dose, Intermittent Vitamin D Supplementation among Older Adults; PMCID:PMC4300188; https://pmc.ncbi.nlm.nih.gov/articles/PMC4300188/
researchEvidence:
  designKind: meta_analysis
  designLabel: meta_analysis
  populationLabel: Older adults in high-dose intermittent vitamin D trials
  durationLabel: Across included trial follow-up windows; exact trial-level windows varied
  aggregateRole: synthesis
  cohortKey: cohort:pmcid-PMC4300188
  notes:
    - Evidence bucket: intermittent-high-dose-review-context
    - Directness: adjacent_variant; claim use: context-only; priority: high
    - Candidate row: candidate:adjacent-variants:014; shard: adjacent-variants. Schedule/bolus variant: do not generalize effects directly to ordinary daily D3 supplementation without extraction caveats. Candidate rationale: Synthesis focused on high-dose intermittent dosing in older adults; important for preserving mixed or negative boundary evidence.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:pmcid-PMC4300188:001
    sourceKey: source_artifact:pmcid-PMC4300188
    findingKind: intervention_result
    population: Older adults in high-dose intermittent vitamin D trials
    exposure: High-dose intermittent vitamin D, generally >100,000 IU per dose with intervals longer than one month
    outcome: All-cause mortality, hip fracture, non-vertebral fracture, and falls — No overall prevention signal was reported: mortality RR 1.04 (95% CI 0.91–1.17), hip fracture RR 1.17 (0.97–1.41), non-vertebral fracture RR 1.06 (0.91–1.22), and falls RR 1.02 (0.96–1.08).
    summary: The meta-analysis found no overall protective effect of high-dose intermittent vitamin D on mortality, fracture, or falls outcomes.
    evidenceUse:
      - adjacent_variant
  -
    findingId: finding:daily-vitamin-d3-supplementation:pmcid-PMC4300188:002
    sourceKey: source_artifact:pmcid-PMC4300188
    findingKind: safety
    population: Older adults in high-dose intermittent vitamin D trials with falls data
    exposure: High-dose intermittent vitamin D
    outcome: Falls — A sensitivity analysis reported an increased falls estimate, RR 1.08 (95% CI 1.02–1.14), while the main falls estimate was neutral.
    summary: The review contains a possible falls signal under high-dose intermittent dosing, so falls should be tracked as a safety boundary rather than a daily-D3 efficacy claim.
    evidenceUse:
      - adjacent_variant
      - safety
  -
    findingId: finding:daily-vitamin-d3-supplementation:pmcid-PMC4300188:003
    sourceKey: source_artifact:pmcid-PMC4300188
    findingKind: other
    population: Older adult high-dose intermittent vitamin D trial evidence base
    exposure: High-dose intermittent vitamin D
    outcome: External validity for daily D3 protocols — The authors noted route, population, and regimen differences; optimal regimen remained unclear.
    summary: The source is useful for schedule-boundary language, not for daily D3 protocol efficacy.
    evidenceUse:
      - adjacent_variant
---

This source page stores extracted Health Commons evidence for **A Meta-Analysis of High Dose, Intermittent Vitamin D Supplementation among Older Adults**.

## Evidence role

- Evidence bucket: `intermittent-high-dose-review-context`
- Directness for Daily Vitamin D3 Supplementation: `adjacent_variant`
- Protocol claim use: `context-only`
- Source key: `source_artifact:pmcid-PMC4300188`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:pmcid-PMC4300188:001` (intervention_result): The meta-analysis found no overall protective effect of high-dose intermittent vitamin D on mortality, fracture, or falls outcomes.
- `finding:daily-vitamin-d3-supplementation:pmcid-PMC4300188:002` (safety): The review contains a possible falls signal under high-dose intermittent dosing, so falls should be tracked as a safety boundary rather than a daily-D3 efficacy claim.
- `finding:daily-vitamin-d3-supplementation:pmcid-PMC4300188:003` (other): The source is useful for schedule-boundary language, not for daily D3 protocol efficacy.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
