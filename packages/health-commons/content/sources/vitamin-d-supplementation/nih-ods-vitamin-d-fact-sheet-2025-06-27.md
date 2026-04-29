---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nih-ods-vitamin-d-fact-sheet-2025-06-27
slug: sources/vitamin-d-supplementation/nih-ods-vitamin-d-fact-sheet-2025-06-27
title: Vitamin D: Fact Sheet for Health Professionals
summary: NIH ODS supports explicit warnings that vitamin D toxicity is primarily an excess-supplement problem and can present with calcium-related laboratory abnormalities and kidney-stone symptoms.
status: draft
quality: usable
aliases:
  - Vitamin D: Fact Sheet for Health Professionals
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
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
  canonicalUrl: https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
source:
  kind: web_page
  title: Vitamin D: Fact Sheet for Health Professionals
  url: https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
  citation: Vitamin D: Fact Sheet for Health Professionals; https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: Health-professional safety reference users
  durationLabel: Reference-page synthesis
  aggregateRole: context
  cohortKey: cohort:nih-ods-vitamin-d-fact-sheet-2025-06-27
  notes:
    - Evidence bucket: current-reference-intake-safety-background
    - Directness: background; claim use: safety-only; priority: backbone
    - Deduped from 3 candidate rows across shards: baseline-status, population-subgroups, safety. Candidate rationale: Authoritative current reference for status assessment and safety framing; not a primary trial source.
sourceFindings:

  -
    findingId: finding:daily-vitamin-d3-supplementation:nih-ods-vitamin-d-fact-sheet-2025-06-27:001
    sourceKey: source_artifact:nih-ods-vitamin-d-fact-sheet-2025-06-27
    findingKind: safety
    population: Health-professional safety reference users
    exposure: Excess vitamin D supplement intake
    outcome: Vitamin D toxicity presentation — Toxicity is framed around hypercalcemia, hypercalciuria, high serum 25(OH)D, and potential renal and soft-tissue complications.
    summary: NIH ODS supports explicit warnings that vitamin D toxicity is primarily an excess-supplement problem and can present with calcium-related laboratory abnormalities and kidney-stone symptoms.
    evidenceUse:
      - safety
  -
    findingId: finding:daily-vitamin-d3-supplementation:nih-ods-vitamin-d-fact-sheet-2025-06-27:002
    sourceKey: source_artifact:nih-ods-vitamin-d-fact-sheet-2025-06-27
    findingKind: intervention_result
    population: General intake-reference population
    exposure: Daily vitamin D intake
    outcome: Upper intake level and serum 25(OH)D caution — Adult UL is summarized as 4,000 IU/day; the fact sheet also cautions against sustained high serum 25(OH)D concentrations.
    summary: The source supports dose-boundary and high-status caution language but not any efficacy claim for taking more vitamin D.
    evidenceUse:
      - safety
  -
    findingId: finding:daily-vitamin-d3-supplementation:nih-ods-vitamin-d-fact-sheet-2025-06-27:003
    sourceKey: source_artifact:nih-ods-vitamin-d-fact-sheet-2025-06-27
    findingKind: adverse_event
    population: Postmenopausal women and other users taking calcium with vitamin D, as summarized by NIH ODS
    exposure: Calcium plus vitamin D supplementation
    outcome: Kidney stones — Combined calcium plus vitamin D is summarized as having increased kidney-stone risk in WHI, while attribution to vitamin D alone is not supported.
    summary: Use NIH ODS to reinforce that calcium co-supplementation must be kept separate from D3-only safety claims.
    evidenceUse:
      - safety
---

This source page stores extracted Health Commons evidence for **Vitamin D: Fact Sheet for Health Professionals**.

## Evidence role

- Evidence bucket: `current-reference-intake-safety-background`
- Directness for Daily Vitamin D3 Supplementation: `background`
- Protocol claim use: `safety-only`
- Source key: `source_artifact:nih-ods-vitamin-d-fact-sheet-2025-06-27`

## Extracted findings

- `finding:daily-vitamin-d3-supplementation:nih-ods-vitamin-d-fact-sheet-2025-06-27:001` (safety): NIH ODS supports explicit warnings that vitamin D toxicity is primarily an excess-supplement problem and can present with calcium-related laboratory abnormalities and kidney-stone symptoms.
- `finding:daily-vitamin-d3-supplementation:nih-ods-vitamin-d-fact-sheet-2025-06-27:002` (intervention_result): The source supports dose-boundary and high-status caution language but not any efficacy claim for taking more vitamin D.
- `finding:daily-vitamin-d3-supplementation:nih-ods-vitamin-d-fact-sheet-2025-06-27:003` (adverse_event): Use NIH ODS to reinforce that calcium co-supplementation must be kept separate from D3-only safety claims.

## Protocol-use note

Use this source according to the extracted directness and claim-use fields above. Do not convert adjacent variants, safety-only sources, or context-only findings into direct efficacy claims for the Murph daily D3 protocol.
