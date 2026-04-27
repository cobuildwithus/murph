---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1093-ajcn-nqac152
slug: sources/high-protein-intake/doi-10.1093-ajcn-nqac152
title: "Unprocessed red meat in the dietary treatment of obesity: a randomized controlled trial of beef supplementation during weight maintenance after successful weight loss"
summary: "Protein Floor source ledger record (context-only; adjacent_variant)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - source_delivery_quality
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
    pmcid: PMC9761757
    doi: 10.1093/ajcn/nqac152
    url: https://doi.org/10.1093/ajcn/nqac152/
  identityAliases:
    - source_artifact:doi-10.1093-ajcn-nqac152
    - 10.1093/ajcn/nqac152
    - PMC9761757
  canonicalUrl: https://doi.org/10.1093/ajcn/nqac152/
source:
  kind: journal_article
  title: "Unprocessed red meat in the dietary treatment of obesity: a randomized controlled trial of beef supplementation during weight maintenance after successful weight loss"
  doi: 10.1093/ajcn/nqac152
  url: https://doi.org/10.1093/ajcn/nqac152/
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-006; priority: medium; claimUse: context-only; directness: adjacent_variant"
sourceFindings:
  -
    findingId: finding:doi-10.1093-ajcn-nqac152-beef-maintenance-no-advantage
    sourceKey: source_artifact:doi-10.1093-ajcn-nqac152
    findingKind: intervention_result
    population: "Adults with obesity who entered weight maintenance after rapid weight loss."
    exposure: "150 g/day versus 25 g/day unprocessed beef supplementation during maintenance."
    outcome: "Weight maintenance, body composition, resting energy expenditure, and cardiometabolic risk factors."
    summary: "The extracted results did not show a clear between-group advantage for higher unprocessed beef intake during the maintenance phase."
    evidenceUse:
      - efficacy
      - adjacent_variant
  -
    findingId: finding:doi-10.1093-ajcn-nqac152-red-meat-source-boundary
    sourceKey: source_artifact:doi-10.1093-ajcn-nqac152
    findingKind: context
    population: "Post-weight-loss adults in a maintenance trial."
    exposure: "Unprocessed beef supplementation as a protein-source strategy."
    outcome: "Protocol interpretation."
    summary: "The trial addresses beef dose within maintenance, not whether a 1.5-2.0 g/kg/day protein floor is effective."
    evidenceUse:
      - context
      - adjacent_variant
evidenceBucket: source_delivery_quality
protocolTakeaway: "Use as no-clear-advantage source-dose context; do not infer that higher red-meat delivery improves protein-floor outcomes."
claimUse: context-only
directness: adjacent_variant
murphV1Priority: medium
aliases:
  - doi-10.1093-ajcn-nqac152
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (adjacent_variant).
- **Evidence bucket:** source_delivery_quality.
- **Extraction batch:** batch-006.

## Artifact pointer

- **art_doi_10.1093_ajcn_nqac152** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:doi-10.1093-ajcn-nqac152-beef-maintenance-no-advantage** — The extracted results did not show a clear between-group advantage for higher unprocessed beef intake during the maintenance phase.
- **finding:doi-10.1093-ajcn-nqac152-red-meat-source-boundary** — The trial addresses beef dose within maintenance, not whether a 1.5-2.0 g/kg/day protein floor is effective.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake/doi-10.1093-ajcn-nqac152/protein-source-supplement-delivery-source-quality** — Higher beef supplementation did not clearly improve post-weight-loss maintenance outcomes. Implication: Use as no-clear-advantage source-dose context; do not infer that higher red-meat delivery improves protein-floor outcomes.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
