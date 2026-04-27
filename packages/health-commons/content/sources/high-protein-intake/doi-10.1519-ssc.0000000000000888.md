---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1519-ssc.0000000000000888
slug: sources/high-protein-intake/doi-10.1519-ssc.0000000000000888
title: "Effect of Dietary Protein on Fat-Free Mass in Energy Restricted, Resistance-Trained Individuals: An Updated Systematic Review With Meta-Regression"
summary: "Protein Floor source ledger record (context-only; adjacent_variant)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - training_strength_body_composition
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
    doi: 10.1519/ssc.0000000000000888
    url: https://journals.lww.com/nsca-scj/fulltext/9900/effect_of_dietary_protein_on_fat_free_mass_in.179.aspx/
  identityAliases:
    - source_artifact:doi-10.1519-ssc.0000000000000888
    - 10.1519/ssc.0000000000000888
  canonicalUrl: https://journals.lww.com/nsca-scj/fulltext/9900/effect_of_dietary_protein_on_fat_free_mass_in.179.aspx/
source:
  kind: review
  title: "Effect of Dietary Protein on Fat-Free Mass in Energy Restricted, Resistance-Trained Individuals: An Updated Systematic Review With Meta-Regression"
  doi: 10.1519/ssc.0000000000000888
  url: https://journals.lww.com/nsca-scj/fulltext/9900/effect_of_dietary_protein_on_fat_free_mass_in.179.aspx/
researchEvidence:
  designKind: meta_analysis
  designLabel: "meta analysis"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-004; priority: high; claimUse: context-only; directness: adjacent_variant"
sourceFindings:
  -
    findingId: finding:doi-10-1519-ssc-0000000000000888-fat-free-mass-meta-regression
    sourceKey: source_artifact:doi-10.1519-ssc.0000000000000888
    extractedFromArtifactId: art_doi_10_1519_ssc_0000000000000888
    findingKind: intervention_result
    population: "Energy-restricted resistance-trained individuals across included studies"
    exposure: "Higher dietary protein dose examined by systematic review/meta-regression"
    outcome: "Fat-free mass/body composition"
    summary: "The review evaluates whether higher dietary protein relates to fat-free-mass change during energy restriction in resistance-trained individuals; it is adjacent because energy deficit and training status are core inclusion features."
    evidenceUse:
      - adjacent_variant
      - efficacy
evidenceBucket: training_strength_body_composition
protocolTakeaway: "Useful for body-composition variant boundaries and dose-response context in dieting athletes."
claimUse: context-only
directness: adjacent_variant
murphV1Priority: high
aliases:
  - doi-10.1519-ssc.0000000000000888
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (adjacent_variant).
- **Evidence bucket:** training_strength_body_composition.
- **Extraction batch:** batch-004.

## Artifact pointer

- **art_doi_10_1519_ssc_0000000000000888** — external html pointer; rights: permission_required; redistributable: False

## Extracted findings

- **finding:doi-10-1519-ssc-0000000000000888-fat-free-mass-meta-regression** — The review evaluates whether higher dietary protein relates to fat-free-mass change during energy restriction in resistance-trained individuals; it is adjacent because energy deficit and training status are core inclusion features.

## Protocol appraisal

- **evidence_appraisal:doi_10_1519_ssc_0000000000000888:resistance_training_athlete_body_composition_adjacent_evidence** — Energy-restricted trained-athlete meta-regression is adjacent, not direct floor evidence. Implication: Useful for body-composition variant boundaries and dose-response context in dieting athletes.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
