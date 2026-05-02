---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02278757
slug: sources/high-protein-intake/clinicaltrials-nct02278757
title: "Effect of a High Protein Diet on Weight Loss in Adults With Obesity"
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
    registryId: NCT02278757
    url: https://clinicaltrials.gov/study/NCT02278757/
  identityAliases:
    - source_artifact:clinicaltrials-nct02278757
    - NCT02278757
  canonicalUrl: https://clinicaltrials.gov/study/NCT02278757/
source:
  kind: web_page
  title: "Effect of a High Protein Diet on Weight Loss in Adults With Obesity"
  authors: "Mexican National Institute of Public Health"
  journal: "ClinicalTrials.gov"
  url: https://clinicaltrials.gov/study/NCT02278757/
researchEvidence:
  designKind: other
  designLabel: "trial registry"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: medium; claimUse: context-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct02278757-registry-design
    sourceKey: source_artifact:clinicaltrials-nct02278757
    extractedFromArtifactId: art_clinicaltrials_nct02278757_registry
    findingKind: context
    population: "Adults aged 20-65 years with metabolic syndrome"
    exposure: "1.34 g/kg/day high-protein meal-replacement diet versus 0.8 g/kg/day low-protein diet, both with 500 kcal/day restriction and exercise advice"
    outcome: "Planned body-weight and cardiometabolic-marker outcomes over 6 months"
    summary: "Registry record describes a 118-participant randomized clinical trial in adults with metabolic syndrome comparing 1.34 versus 0.8 g/kg/day protein diets under equal calorie restriction; ClinicalTrials.gov has no posted results."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:clinicaltrials-nct02278757-publication-linkage
    sourceKey: source_artifact:clinicaltrials-nct02278757
    extractedFromArtifactId: art_clinicaltrials_nct02278757_registry
    findingKind: context
    population: "Adults with metabolic syndrome in the DPMS trial"
    exposure: "ClinicalTrials.gov derived-publication linkage"
    outcome: "Publication linkage"
    summary: "ClinicalTrials.gov links NCT02278757 to derived publication PMID 28601864; publication results should be extracted from the publication source, not the registry record."
    evidenceUse:
      - context
evidenceBucket: trial_registry_context
protocolTakeaway: "Use to document a clinical high- versus standard-protein weight-loss design and its linked publication."
claimUse: context-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - clinicaltrials-nct02278757
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct02278757_registry** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct02278757-registry-design** — Registry record describes a 118-participant randomized clinical trial in adults with metabolic syndrome comparing 1.34 versus 0.8 g/kg/day protein diets under equal calorie restriction; ClinicalTrials.gov has no posted results.
- **finding:clinicaltrials-nct02278757-publication-linkage** — ClinicalTrials.gov links NCT02278757 to derived publication PMID 28601864; publication results should be extracted from the publication source, not the registry record.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct02278757-protein-floor-registry-context** — Lower-dose high-protein meal-replacement registry context Implication: Use to document a clinical high- versus standard-protein weight-loss design and its linked publication.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
