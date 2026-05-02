---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1017-s0029665112000122
slug: sources/high-protein-intake/doi-10.1017-s0029665112000122
title: "Safety and efficacy of high-protein diets for weight loss"
summary: "Protein Floor source ledger record (safety-only; measurement_context)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - safety_kidney_renal
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
    doi: 10.1017/s0029665112000122
    url: https://doi.org/10.1017/S0029665112000122/
  identityAliases:
    - source_artifact:doi-10.1017-s0029665112000122
    - 10.1017/s0029665112000122
  canonicalUrl: https://doi.org/10.1017/S0029665112000122/
source:
  kind: review
  title: "Safety and efficacy of high-protein diets for weight loss"
  authors: Alexandra M. Johnstone
  journal: Proceedings of the Nutrition Society
  doi: 10.1017/s0029665112000122
  url: https://doi.org/10.1017/S0029665112000122/
researchEvidence:
  designKind: narrative_review
  designLabel: "narrative review"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-010; priority: backbone; claimUse: safety-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:doi-10.1017-s0029665112000122-healthy-renal-risk-context
    sourceKey: source_artifact:doi-10.1017-s0029665112000122
    extractedFromArtifactId: art_pmid_22397883
    findingKind: safety
    population: "Healthy adult populations discussed in high-protein weight-loss diet literature."
    exposure: "High-protein weight-loss diets with variable definitions and dose reporting."
    outcome: "Renal safety boundary."
    summary: "The review reports little evidence that high-protein diets pose a serious kidney-function risk in healthy populations, while identifying susceptible groups for caution."
    evidenceUse:
      - safety
      - context
  -
    findingId: finding:doi-10.1017-s0029665112000122-susceptible-renal-caution
    sourceKey: source_artifact:doi-10.1017-s0029665112000122
    extractedFromArtifactId: art_pmid_22397883
    findingKind: safety
    population: "People with diabetes or existing renal disease discussed as susceptible groups."
    exposure: "Higher-protein intake in weight-loss or low-carbohydrate diet contexts."
    outcome: "Renal-function caution."
    summary: "The review flags diabetes and existing renal disease as populations where higher-protein intake should be handled more cautiously than in healthy adults."
    evidenceUse:
      - safety
evidenceBucket: safety_kidney_renal
protocolTakeaway: "Use to justify renal-risk screening and CKD/diabetes caution, not to claim efficacy of the protein floor."
claimUse: safety-only
directness: measurement_context
murphV1Priority: backbone
aliases:
  - doi-10.1017-s0029665112000122
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** safety-only (measurement_context).
- **Evidence bucket:** safety_kidney_renal.
- **Extraction batch:** batch-010.

## Artifact pointer

- **art_pmid_22397883** — external html pointer; rights: permission_required; redistributable: False

## Extracted findings

- **finding:doi-10.1017-s0029665112000122-healthy-renal-risk-context** — The review reports little evidence that high-protein diets pose a serious kidney-function risk in healthy populations, while identifying susceptible groups for caution.
- **finding:doi-10.1017-s0029665112000122-susceptible-renal-caution** — The review flags diabetes and existing renal disease as populations where higher-protein intake should be handled more cautiously than in healthy adults.

## Protocol appraisal

- **evidence_appraisal:doi-10.1017-s0029665112000122-protein-floor-kidney-boundary** — Narrative renal-safety review separates healthy populations from susceptible groups. Implication: Use to justify renal-risk screening and CKD/diabetes caution, not to claim efficacy of the protein floor.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
