---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00390637
slug: sources/high-protein-intake/clinicaltrials-nct00390637
title: "DiOGenes: Diet, Obesity and Genes Study"
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
    registryId: NCT00390637
    url: https://clinicaltrials.gov/study/NCT00390637/
  identityAliases:
    - source_artifact:clinicaltrials-nct00390637
    - NCT00390637
  canonicalUrl: https://clinicaltrials.gov/study/NCT00390637/
source:
  kind: web_page
  title: "DiOGenes: Diet, Obesity and Genes Study"
  url: https://clinicaltrials.gov/study/NCT00390637/
researchEvidence:
  designKind: other
  designLabel: "trial registry"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: medium; claimUse: context-only; directness: measurement_context"
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct00390637-registry-design
    sourceKey: source_artifact:clinicaltrials-nct00390637
    extractedFromArtifactId: art_clinicaltrials_nct00390637_registry
    findingKind: context
    population: "Overweight/obese adults and families in eight European countries after initial low-calorie weight loss"
    exposure: "Reduced-fat diets varying by high/low protein content and high/low glycemic index, plus control recommendations"
    outcome: "Planned weight-maintenance, body-composition, adherence, diabetes-risk, and cardiovascular-risk outcomes"
    summary: "Registry record describes an estimated 1020-participant randomized DiOGenes maintenance intervention with factorial protein and glycemic-index arms after an 8-week low-calorie diet run-in; the registry does not report g/kg protein targets or posted results."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:clinicaltrials-nct00390637-publication-linkage
    sourceKey: source_artifact:clinicaltrials-nct00390637
    extractedFromArtifactId: art_clinicaltrials_nct00390637_registry
    findingKind: context
    population: "DiOGenes trial participants"
    exposure: "ClinicalTrials.gov derived-publication linkage"
    outcome: "Publication linkage"
    summary: "ClinicalTrials.gov links NCT00390637 to numerous derived publications, including PMID 21105792 and PMID 22104550, but registry findings should not be merged with publication effect estimates unless those publication source pages are extracted separately."
    evidenceUse:
      - context
evidenceBucket: trial_registry_context
protocolTakeaway: "Use to map DiOGenes protocol arms and linked publications before citing any publication-specific result."
claimUse: context-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - clinicaltrials-nct00390637
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct00390637_registry** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct00390637-registry-design** — Registry record describes an estimated 1020-participant randomized DiOGenes maintenance intervention with factorial protein and glycemic-index arms after an 8-week low-calorie diet run-in; the registry does not report g/kg protein targets or posted results.
- **finding:clinicaltrials-nct00390637-publication-linkage** — ClinicalTrials.gov links NCT00390637 to numerous derived publications, including PMID 21105792 and PMID 22104550, but registry findings should not be merged with publication effect estimates unless those publication source pages are extracted separately.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct00390637-protein-floor-registry-context** — DiOGenes registry is publication-linkage and design context Implication: Use to map DiOGenes protocol arms and linked publications before citing any publication-specific result.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
