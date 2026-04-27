---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.17226-10490
slug: sources/high-protein-intake/doi-10.17226-10490
title: "Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids"
summary: "Protein Floor source ledger record (context-only; general_guideline)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - external_guideline_context
relations:
  -
    type: related_protocol
    target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
  -
    type: parent_family
    target: experiment_family:high-protein-intake
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: doi
  identifiers:
    doi: 10.17226/10490
    url: https://nap.nationalacademies.org/catalog/10490/dietary-reference-intakes-for-energy-carbohydrate-fiber-fat-fatty-acids-cholesterol-protein-and-amino-acids/
  identityAliases:
    - source_artifact:doi-10.17226-10490
    - 10.17226/10490
  canonicalUrl: https://nap.nationalacademies.org/catalog/10490/dietary-reference-intakes-for-energy-carbohydrate-fiber-fat-fatty-acids-cholesterol-protein-and-amino-acids/
source:
  kind: guideline
  title: "Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids"
  doi: 10.17226/10490
  url: https://nap.nationalacademies.org/catalog/10490/dietary-reference-intakes-for-energy-carbohydrate-fiber-fat-fatty-acids-cholesterol-protein-and-amino-acids/
researchEvidence:
  designKind: guideline
  designLabel: guideline
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-016; priority: medium; claimUse: context-only; directness: general_guideline"
sourceFindings:
  -
    findingId: finding:doi-10.17226-10490-adult-rda-context
    findingKind: context
    population: "General adult population reference-intake users."
    exposure: "Dietary protein intake at reference adequacy levels."
    outcome: "RDA and adequacy comparator."
    summary: "The DRI report provides adult protein reference values, commonly summarized as 0.8 g/kg/day for adult RDA-level adequacy, which serves as a comparator rather than a performance or body-composition target."
    evidenceUse:
      - context
    sourceKey: source_artifact:doi-10.17226-10490
    extractedFromArtifactId: art_doi_10_17226_10490
  -
    findingId: finding:doi-10.17226-10490-amdr-ul-context
    findingKind: safety
    population: "General population covered by macronutrient reference ranges."
    exposure: "Protein as a share of total energy intake."
    outcome: "Acceptable macronutrient distribution and upper-limit context."
    summary: "The report places adult protein in the 10-35% energy AMDR and did not establish a specific tolerable upper intake level for protein because a clearly defined adverse-effect intake level was not identified from the evidence base."
    evidenceUse:
      - safety
      - context
    sourceKey: source_artifact:doi-10.17226-10490
    extractedFromArtifactId: art_doi_10_17226_10490
evidenceBucket: external_guideline_context
protocolTakeaway: "Use to define baseline adequacy and avoid confusing RDA with a performance or weight-management target."
claimUse: context-only
directness: general_guideline
murphV1Priority: medium
aliases:
  - doi-10.17226-10490
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (general_guideline).
- **Evidence bucket:** external_guideline_context.
- **Extraction batch:** batch-016.

## Artifact pointer

- **art_doi_10_17226_10490** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:doi-10.17226-10490-adult-rda-context** — The DRI report provides adult protein reference values, commonly summarized as 0.8 g/kg/day for adult RDA-level adequacy, which serves as a comparator rather than a performance or body-composition target.
- **finding:doi-10.17226-10490-amdr-ul-context** — The report places adult protein in the 10-35% energy AMDR and did not establish a specific tolerable upper intake level for protein because a clearly defined adverse-effect intake level was not identified from the evidence base.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:doi-10.17226-10490** — National Academies DRI provides the RDA comparator and AMDR context, not a protein-floor efficacy claim. Implication: Use to define baseline adequacy and avoid confusing RDA with a performance or weight-management target.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
