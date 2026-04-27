---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-j.nutos.2025.05.008
slug: sources/high-protein-intake/doi-10.1016-j.nutos.2025.05.008
title: "The role of protein intake distribution across meals in maintenance of physical performance and muscle strength in older adults: An exploratory study based on secondary data analysis of the PRevention Of Malnutrition In Senior Subjects in…"
summary: "Protein Floor source ledger record (context-only; adjacent_variant)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - meal_distribution_pacing
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
    doi: 10.1016/j.nutos.2025.05.008
    url: https://doi.org/10.1016/j.nutos.2025.05.008/
  identityAliases:
    - source_artifact:doi-10.1016-j.nutos.2025.05.008
    - 10.1016/j.nutos.2025.05.008
  canonicalUrl: https://doi.org/10.1016/j.nutos.2025.05.008/
source:
  kind: journal_article
  title: "The role of protein intake distribution across meals in maintenance of physical performance and muscle strength in older adults: An exploratory study based on secondary data analysis of the PRevention Of Malnutrition In Senior Subjects in the EU (PROMISS) trial"
  doi: 10.1016/j.nutos.2025.05.008
  url: https://doi.org/10.1016/j.nutos.2025.05.008/
researchEvidence:
  designKind: other
  designLabel: other
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-007; priority: medium; claimUse: context-only; directness: adjacent_variant"
sourceFindings:
  -
    findingId: finding:doi-10-1016-j-nutos-2025-05-008-promiss-distribution-performance-null
    findingKind: context
    population: "276 community older adults with habitual low protein intake in PROMISS data."
    exposure: "Meal-level protein distribution metrics."
    outcome: "400-m walk time and leg extension strength."
    summary: "Protein distribution metrics were not meaningfully associated with walking time or leg extension strength cross-sectionally or longitudinally, apart from a women-only baseline association in the opposite direction."
    evidenceUse:
      - context
      - measurement
    sourceKey: source_artifact:doi-10.1016-j.nutos.2025.05.008
    extractedFromArtifactId: art_doi_10_1016_j_nutos_2025_05_008
evidenceBucket: meal_distribution_pacing
protocolTakeaway: "Useful as a guardrail against adding complex distribution targets to the base protocol."
claimUse: context-only
directness: adjacent_variant
murphV1Priority: medium
aliases:
  - doi-10.1016-j.nutos.2025.05.008
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (adjacent_variant).
- **Evidence bucket:** meal_distribution_pacing.
- **Extraction batch:** batch-007.

## Artifact pointer

- **art_doi_10_1016_j_nutos_2025_05_008** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:doi-10-1016-j-nutos-2025-05-008-promiss-distribution-performance-null** — Protein distribution metrics were not meaningfully associated with walking time or leg extension strength cross-sectionally or longitudinally, apart from a women-only baseline association in the opposite direction.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:doi-10-1016-j-nutos-2025-05-008** — PROMISS secondary analysis did not find distribution metrics useful for strength or walking outcomes. Implication: Useful as a guardrail against adding complex distribution targets to the base protocol.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
