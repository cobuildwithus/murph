---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.foodqual.2015.01.016
slug: sources/high-protein-intake/doi-10.1016-j.foodqual.2015.01.016
title: "Examining heterogeneity in elderly consumers’ acceptance of carriers for protein-enriched food: A segmentation study"
summary: "Protein Floor source ledger record (context-only; adjacent_variant)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - population_strata_requirement
relations:
  -
    type: related_protocol
    target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
  -
    type: parent_family
    target: experiment_family:high-protein-intake
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/j.foodqual.2015.01.016
    url: https://doi.org/10.1016/j.foodqual.2015.01.016/
  identityAliases:
    - source_artifact:doi-10.1016-j.foodqual.2015.01.016
    - 10.1016/j.foodqual.2015.01.016
  canonicalUrl: https://doi.org/10.1016/j.foodqual.2015.01.016/
source:
  kind: journal_article
  title: "Examining heterogeneity in elderly consumers’ acceptance of carriers for protein-enriched food: A segmentation study"
  doi: 10.1016/j.foodqual.2015.01.016
  url: https://doi.org/10.1016/j.foodqual.2015.01.016/
researchEvidence:
  designKind: other
  designLabel: "consumer acceptance   segmentation study"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-008; priority: medium; claimUse: context-only; directness: adjacent_variant"
sourceFindings:
  -
    findingId: finding:doi-10.1016-j.foodqual.2015.01.016-population-requirement-context
    sourceKey: source_artifact:doi-10.1016-j.foodqual.2015.01.016
    findingKind: context
    population: "Older consumers aged 56–87 years."
    exposure: "Consumer acceptance evaluation of carriers for protein-enriched food."
    outcome: "willingness to purchase; consumer segmentation; protein-enriched product acceptability"
    summary: "The survey found heterogeneity and generally low willingness to purchase for several protein-enriched food carriers."
    evidenceUse:
      - context
      - measurement
evidenceBucket: population_strata_requirement
protocolTakeaway: "Useful for product choice and adherence planning."
claimUse: context-only
directness: adjacent_variant
murphV1Priority: medium
aliases:
  - doi-10.1016-j.foodqual.2015.01.016
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (adjacent_variant).
- **Evidence bucket:** population_strata_requirement.
- **Extraction batch:** batch-008.

## Artifact pointer

- **art_doi_10_1016_j_foodqual_2015_01_016_pdf** — external html pointer; rights: unknown; redistributable: False

## Extracted findings

- **finding:doi-10.1016-j.foodqual.2015.01.016-population-requirement-context** — The survey found heterogeneity and generally low willingness to purchase for several protein-enriched food carriers.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake-doi-10.1016-j.foodqual.2015.01.016-population-requirement-context** — Older consumers varied in acceptance of protein-enriched food carriers. Implication: Useful for product choice and adherence planning.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
