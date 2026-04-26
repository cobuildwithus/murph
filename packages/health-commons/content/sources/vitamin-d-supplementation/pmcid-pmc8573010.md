---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:pmcid-PMC8573010
slug: sources/vitamin-d-supplementation/pmcid-pmc8573010
title: Active vitamin D increases the risk of hypercalcaemia in non-dialysis chronic kidney disease patients with secondary hyperparathyroidism: a systematic review and meta-analysis
summary: Active vitamin D in CKD is a hypercalcaemia safety boundary.
status: draft
quality: usable
aliases:
  - Active vitamin D increases the risk of hypercalcaemia in non-dialysis chronic kidney disease patients with secondary hyperparathyroidism: a systematic review and meta-analysis
  - PMC8573010
  - source_artifact:pmcid-PMC8573010
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
    pmcid: PMC8573010
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC8573010/
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC8573010/
  identityAliases:
    - source_artifact:pmcid-PMC8573010
source:
  kind: review
  title: Active vitamin D increases the risk of hypercalcaemia in non-dialysis chronic kidney disease patients with secondary hyperparathyroidism: a systematic review and meta-analysis
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC8573010/
  citation: Active vitamin D increases the risk of hypercalcaemia in non-dialysis chronic kidney disease patients with secondary hyperparathyroidism: a systematic review and meta-analysis; PMCID:PMC8573010; https://pmc.ncbi.nlm.nih.gov/articles/PMC8573010/
researchEvidence:
  designKind: meta_analysis
  designLabel: meta_analysis
  populationLabel: Non-dialysis chronic kidney disease patients with secondary hyperparathyroidism
  durationLabel: Trial follow-up windows varied; not fully extracted
  aggregateRole: synthesis
  cohortKey: cohort:pmcid-PMC8573010
  notes:
    - Evidence bucket: active-analogue-and-ckd-clinical-supervised-context
    - Directness: clinical_supervised; claim use: safety-only; priority: high
    - Candidate row: candidate:adjacent-variants:031; shard: adjacent-variants. Clinical-supervised/CKD or active-analogue context only; do not use as native over-the-counter cholecalciferol evidence. Candidate rationale: Focused safety synthesis for active vitamin D; preserves adverse-event boundary evidence.
sourceFindings:
  -
    findingId: finding:daily-vitamin-d3-supplementation:pmcid-PMC8573010:001
    sourceKey: source_artifact:pmcid-PMC8573010
    findingKind: adverse_event
    population: Non-dialysis chronic kidney disease patients with secondary hyperparathyroidism
    exposure: Active vitamin D therapy
    outcome: hypercalcaemia — Meta-analysis reported increased hypercalcaemia risk with active vitamin D in non-dialysis CKD with secondary hyperparathyroidism; one accessible abstract summary reports OR 6.63 (95% CI 2.37 to 18.55).
    summary: Active vitamin D in CKD is a hypercalcaemia safety boundary.
    evidenceUse:
      - safety
---

This source page stores extracted Health Commons evidence for **Active vitamin D increases the risk of hypercalcaemia in non-dialysis chronic kidney disease patients with secondary hyperparathyroidism: a systematic review and meta-analysis**.

## Evidence role

- Evidence bucket: `active-analogue-and-ckd-clinical-supervised-context`
- Directness for Daily Vitamin D3 Supplementation: `clinical_supervised`
- Protocol claim use: `safety-only`
- Source key: `source_artifact:pmcid-PMC8573010`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:pmcid-PMC8573010:001` (adverse_event): Active vitamin D in CKD is a hypercalcaemia safety boundary.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
