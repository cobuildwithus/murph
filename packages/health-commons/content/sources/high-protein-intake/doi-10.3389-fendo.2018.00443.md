---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3389-fendo.2018.00443
slug: sources/high-protein-intake/doi-10.3389-fendo.2018.00443
title: "Dietary protein and energy balance in relation to obesity and co-morbidities"
summary: "Protein Floor source ledger record (context-only; measurement_context)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - systematic_review_anchor
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
    pmcid: PMC6087750
    doi: 10.3389/fendo.2018.00443
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC6087750/
  identityAliases:
    - source_artifact:doi-10.3389-fendo.2018.00443
    - 10.3389/fendo.2018.00443
    - PMC6087750
  canonicalUrl: https://pmc.ncbi.nlm.nih.gov/articles/PMC6087750/
source:
  kind: review
  title: "Dietary protein and energy balance in relation to obesity and co-morbidities"
  doi: 10.3389/fendo.2018.00443
  url: https://pmc.ncbi.nlm.nih.gov/articles/PMC6087750/
researchEvidence:
  designKind: narrative_review
  designLabel: "narrative review"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-002; priority: medium; claimUse: context-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:doi-10.3389-fendo.2018.00443-energy-balance-ffm
    sourceKey: source_artifact:doi-10.3389-fendo.2018.00443
    extractedFromArtifactId: art_doi_10_3389_fendo_2018_00443
    findingKind: context
    population: "Human obesity and energy-balance literature reviewed narratively."
    exposure: "Higher-protein or relatively high-protein diets during energy balance, energy restriction, or maintenance."
    outcome: "Body weight, fat loss, fat-free mass, satiety, and energy expenditure."
    summary: "The review states that dietary protein can promote satiety, energy expenditure, and body-composition changes favoring fat-free mass; during energy restriction, additional protein may help maintain more fat-free mass even when it does not produce larger body-weight loss."
    evidenceUse:
      - context
      - mechanism
  -
    findingId: finding:doi-10.3389-fendo.2018.00443-comorbidity-inconclusive
    sourceKey: source_artifact:doi-10.3389-fendo.2018.00443
    extractedFromArtifactId: art_doi_10_3389_fendo_2018_00443
    findingKind: context
    population: "Literature on higher-protein diets and obesity-related comorbidities."
    exposure: "Higher-protein diets, often high-protein/low-carbohydrate patterns."
    outcome: "NAFLD, type 2 diabetes, cardiovascular disease, insulin sensitivity, and intrahepatic triglyceride context."
    summary: "The review concludes that whether high-protein diets contribute to preventing increases in NAFLD, type 2 diabetes, or cardiovascular diseases beyond their weight-management effects is inconclusive."
    evidenceUse:
      - context
      - safety
evidenceBucket: systematic_review_anchor
protocolTakeaway: "Useful for choosing Murph endpoints and caveating metabolic claims."
claimUse: context-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - doi-10.3389-fendo.2018.00443
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** systematic_review_anchor.
- **Extraction batch:** batch-002.

## Artifact pointer

- **art_doi_10_3389_fendo_2018_00443** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:doi-10.3389-fendo.2018.00443-energy-balance-ffm** — The review states that dietary protein can promote satiety, energy expenditure, and body-composition changes favoring fat-free mass; during energy restriction, additional protein may help maintain more fat-free mass even when it does not produce larger body-weight loss.
- **finding:doi-10.3389-fendo.2018.00443-comorbidity-inconclusive** — The review concludes that whether high-protein diets contribute to preventing increases in NAFLD, type 2 diabetes, or cardiovascular diseases beyond their weight-management effects is inconclusive.

## Protocol appraisal

- **evidence_appraisal:protein-floor-high-protein-intake:doi-10.3389-fendo.2018.00443** — Mechanistic review links protein to satiety, energy expenditure, and fat-free mass but keeps comorbidity claims inconclusive. Implication: Useful for choosing Murph endpoints and caveating metabolic claims.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
