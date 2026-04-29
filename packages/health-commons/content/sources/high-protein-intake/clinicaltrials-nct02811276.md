---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02811276
slug: sources/high-protein-intake/clinicaltrials-nct02811276
title: "High-Protein Total Diet Replacement and Energy Metabolism in Men"
summary: "Protein Floor source ledger record (context-only; measurement_context)."
status: draft
quality: usable
categories:
  - high-protein-intake
  - protein-floor
  - trial_registry_context
relations:

  -
    type: related_protocol
    target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
  -
    type: parent_family
    target: experiment_family:high-protein-intake
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT02811276
    url: https://clinicaltrials.gov/study/NCT02811276/
  identityAliases:
    - source_artifact:clinicaltrials-nct02811276
    - NCT02811276
  canonicalUrl: https://clinicaltrials.gov/study/NCT02811276/
source:
  kind: web_page
  title: "High-Protein Total Diet Replacement and Energy Metabolism in Men"
  url: https://clinicaltrials.gov/study/NCT02811276/
researchEvidence:
  designKind: other
  designLabel: "trial registry"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: medium; claimUse: context-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct02811276-registry-design
    sourceKey: source_artifact:clinicaltrials-nct02811276
    extractedFromArtifactId: art_clinicaltrials_nct02811276_registry
    findingKind: mechanistic
    population: "Healthy normal-weight young women"
    exposure: "32-hour eucaloric high-protein total diet replacement with 40% protein versus 15% protein control diet"
    outcome: "Planned fat balance, energy expenditure, substrate oxidation, appetite, and metabolic blood-marker endpoints"
    summary: "Registry record describes an acute randomized controlled crossover trial in 20 healthy women comparing 32 hours of high-protein total diet replacement with a control diet in a whole-body calorimetry unit; no ClinicalTrials.gov results are posted."
    evidenceUse:
      - mechanism
      - measurement
      - context
  -
    findingId: finding:clinicaltrials-nct02811276-publication-linkage
    sourceKey: source_artifact:clinicaltrials-nct02811276
    extractedFromArtifactId: art_clinicaltrials_nct02811276_registry
    findingKind: context
    population: "Healthy normal-weight adults in related total-diet-replacement trials"
    exposure: "ClinicalTrials.gov derived-publication linkage"
    outcome: "Publication linkage"
    summary: "ClinicalTrials.gov links NCT02811276 to derived publications PMID 33247306 and PMID 34928408 and protocol PMID 31881910; those publication effects should be extracted under publication source keys."
    evidenceUse:
      - context
evidenceBucket: trial_registry_context
protocolTakeaway: "Use to frame possible acute energy-expenditure, substrate-balance, appetite, and blood-marker signals."
claimUse: context-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - clinicaltrials-nct02811276
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct02811276_registry** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct02811276-registry-design** — Registry record describes an acute randomized controlled crossover trial in 20 healthy women comparing 32 hours of high-protein total diet replacement with a control diet in a whole-body calorimetry unit; no ClinicalTrials.gov results are posted.
- **finding:clinicaltrials-nct02811276-publication-linkage** — ClinicalTrials.gov links NCT02811276 to derived publications PMID 33247306 and PMID 34928408 and protocol PMID 31881910; those publication effects should be extracted under publication source keys.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct02811276-protein-floor-registry-context** — Acute metabolic-chamber context for high-protein total diet replacement Implication: Use to frame possible acute energy-expenditure, substrate-balance, appetite, and blood-marker signals.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
