---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1007-s12603-016-0709-y
slug: sources/high-protein-intake/doi-10.1007-s12603-016-0709-y
title: "Gastro-intestinal tolerance and renal safety of protein oral nutritional supplements in nursing home residents: A randomized controlled trial"
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
    doi: 10.1007/s12603-016-0709-y
    url: https://doi.org/10.1007/s12603-016-0709-y/
  identityAliases:
    - source_artifact:doi-10.1007-s12603-016-0709-y
    - 10.1007/s12603-016-0709-y
  canonicalUrl: https://doi.org/10.1007/s12603-016-0709-y/
source:
  kind: journal_article
  title: "Gastro-intestinal tolerance and renal safety of protein oral nutritional supplements in nursing home residents: A randomized controlled trial"
  authors: Piet Ter Wee; M. Kuhn; H. van der Woude; D. van de Looverbosch et al.
  journal: The Journal of Nutrition, Health & Aging
  doi: 10.1007/s12603-016-0709-y
  url: https://doi.org/10.1007/s12603-016-0709-y/
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-010; priority: medium; claimUse: safety-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:doi-10.1007-s12603-016-0709-y-ons-egfr-uacr-no-deterioration
    sourceKey: source_artifact:doi-10.1007-s12603-016-0709-y
    extractedFromArtifactId: art_doi_10_1007_s12603_016_0709_y
    findingKind: safety
    population: "67 nursing-home residents in need of oral nutritional supplementation."
    exposure: "Eight weeks of high-protein oral nutritional supplements: 200 mL/300 kcal/20 g protein or 125 mL/300 kcal/18 g protein."
    outcome: "eGFR, urinary albumin/creatinine ratio, adverse events, and GI tolerance."
    summary: "No significant between-group differences in eGFR or urinary albumin/creatinine ratio were found, and adverse events/renal-parameter changes did not indicate renal deterioration under the tested conditions."
    evidenceUse:
      - safety
      - measurement
  -
    findingId: finding:doi-10.1007-s12603-016-0709-y-stage-three-ckd-clinical-context
    sourceKey: source_artifact:doi-10.1007-s12603-016-0709-y
    extractedFromArtifactId: art_doi_10_1007_s12603_016_0709_y
    findingKind: safety
    population: "Nursing-home residents including patients with stage 3 chronic kidney disease."
    exposure: "High-protein oral nutritional supplementation under trial conditions."
    outcome: "Renal safety boundary."
    summary: "The authors concluded the supplements appeared well tolerated and safe under tested conditions, including residents with stage 3 CKD, but this remains supervised clinical context."
    evidenceUse:
      - safety
evidenceBucket: safety_kidney_renal
protocolTakeaway: "Use for supervised supplement safety context, especially older/frail populations."
claimUse: safety-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - doi-10.1007-s12603-016-0709-y
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** safety-only (measurement_context).
- **Evidence bucket:** safety_kidney_renal.
- **Extraction batch:** batch-010.

## Artifact pointer

- **art_doi_10_1007_s12603_016_0709_y** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:doi-10.1007-s12603-016-0709-y-ons-egfr-uacr-no-deterioration** — No significant between-group differences in eGFR or urinary albumin/creatinine ratio were found, and adverse events/renal-parameter changes did not indicate renal deterioration under the tested conditions.
- **finding:doi-10.1007-s12603-016-0709-y-stage-three-ckd-clinical-context** — The authors concluded the supplements appeared well tolerated and safe under tested conditions, including residents with stage 3 CKD, but this remains supervised clinical context.

## Protocol appraisal

- **evidence_appraisal:doi-10.1007-s12603-016-0709-y-protein-floor-kidney-boundary** — Nursing-home ONS trial found no renal deterioration over eight weeks. Implication: Use for supervised supplement safety context, especially older/frail populations.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
