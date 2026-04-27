---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007-s00394-021-02747-1
slug: sources/high-protein-intake/doi-10.1007-s00394-021-02747-1
title: "A high-protein total diet replacement alters the regulation of food intake and energy homeostasis in healthy, normal-weight adults"
summary: "Protein Floor source ledger record (context-only; same_mechanism)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - energy_balance_satiety_weight
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
    pmcid: PMC9106637
    doi: 10.1007/s00394-021-02747-1
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC9106637/
  identityAliases:
    - source_artifact:doi-10.1007-s00394-021-02747-1
    - 10.1007/s00394-021-02747-1
    - PMC9106637
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC9106637/
source:
  kind: journal_article
  title: "A high-protein total diet replacement alters the regulation of food intake and energy homeostasis in healthy, normal-weight adults"
  doi: 10.1007/s00394-021-02747-1
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC9106637/
researchEvidence:
  designKind: crossover_trial
  designLabel: crossover
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-003; priority: medium; claimUse: context-only; directness: same_mechanism"
sourceFindings:
  -
    findingId: finding:doi-10.1007-s00394-021-02747-1-hormones-not-appetite
    sourceKey: source_artifact:doi-10.1007-s00394-021-02747-1
    extractedFromArtifactId: art_doi_10_1007_s00394_021_02747_1
    findingKind: mechanistic
    population: "43 healthy normal-weight adults in an acute crossover trial."
    exposure: "High-protein total diet replacement versus control diet during 32-hour calorimetry stays."
    outcome: "Subjective appetite sensations and appetite-regulating hormones."
    summary: "Subjective appetite sensations did not differ between diet conditions, while postprandial GLP-1, PYY, and leptin-related responses were higher or altered with the high-protein total diet replacement."
    evidenceUse:
      - mechanism
      - context
  -
    findingId: finding:doi-10.1007-s00394-021-02747-1-directness-boundary
    sourceKey: source_artifact:doi-10.1007-s00394-021-02747-1
    extractedFromArtifactId: art_doi_10_1007_s00394_021_02747_1
    findingKind: context
    population: "Healthy normal-weight adults in an acute formula-based feeding study."
    exposure: "High-protein total diet replacement."
    outcome: "Applicability to a free-living protein-floor protocol."
    summary: "The source is same-mechanism evidence for appetite regulation and energy homeostasis, not direct evidence that 1.5-2.0 g/kg/day improves free-living satiety or weight maintenance."
    evidenceUse:
      - context
evidenceBucket: energy_balance_satiety_weight
protocolTakeaway: "Useful for mechanistic appetite interpretation and for avoiding overclaiming satiety from hormone changes alone."
claimUse: context-only
directness: same_mechanism
murphV1Priority: medium
aliases:
  - doi-10.1007-s00394-021-02747-1
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (same_mechanism).
- **Evidence bucket:** energy_balance_satiety_weight.
- **Extraction batch:** batch-003.

## Artifact pointer

- **art_doi_10_1007_s00394_021_02747_1** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:doi-10.1007-s00394-021-02747-1-hormones-not-appetite** — Subjective appetite sensations did not differ between diet conditions, while postprandial GLP-1, PYY, and leptin-related responses were higher or altered with the high-protein total diet replacement.
- **finding:doi-10.1007-s00394-021-02747-1-directness-boundary** — The source is same-mechanism evidence for appetite regulation and energy homeostasis, not direct evidence that 1.5-2.0 g/kg/day improves free-living satiety or weight maintenance.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:doi-10.1007-s00394-021-02747-1** — High-protein TDR altered appetite hormones but not subjective appetite sensations. Implication: Useful for mechanistic appetite interpretation and for avoiding overclaiming satiety from hormone changes alone.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
