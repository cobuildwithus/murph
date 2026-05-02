---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03870425
slug: sources/high-protein-intake/clinicaltrials-nct03870425
title: "Distribution of Nutrient Derived Amino Acids"
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
    registryId: NCT03870425
    url: https://clinicaltrials.gov/study/NCT03870425/
  identityAliases:
    - source_artifact:clinicaltrials-nct03870425
    - NCT03870425
  canonicalUrl: https://clinicaltrials.gov/study/NCT03870425/
source:
  kind: web_page
  title: "Distribution of Nutrient Derived Amino Acids"
  authors: "Bispebjerg Hospital"
  journal: "ClinicalTrials.gov"
  url: https://clinicaltrials.gov/study/NCT03870425/
researchEvidence:
  designKind: other
  designLabel: "trial registry"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: high; claimUse: context-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct03870425-registry-design
    sourceKey: source_artifact:clinicaltrials-nct03870425
    extractedFromArtifactId: art_clinicaltrials_nct03870425_registry
    findingKind: measurement_validation
    population: "Healthy older adults aged 65-80 years"
    exposure: "Even versus skewed minced-meat dietary-protein distribution"
    outcome: "Planned muscle-protein synthesis and whole-body net protein balance endpoints"
    summary: "Registry record describes a 24-participant randomized controlled trial comparing even versus skewed dietary-protein distribution with 3-day myofibrillar FSR and 10-hour whole-body net protein balance endpoints; ClinicalTrials.gov has no posted results for this record."
    evidenceUse:
      - measurement
      - mechanism
      - context
  -
    findingId: finding:clinicaltrials-nct03870425-publication-linkage
    sourceKey: source_artifact:clinicaltrials-nct03870425
    extractedFromArtifactId: art_clinicaltrials_nct03870425_registry
    findingKind: context
    population: "Healthy older adults"
    exposure: "Trial registry record linked to derived publication"
    outcome: "Publication linkage"
    summary: "ClinicalTrials.gov links this registry record to derived publication PMID 37086618, but the registry source itself does not report the publication's effect estimates."
    evidenceUse:
      - context
evidenceBucket: trial_registry_context
protocolTakeaway: "Use for measurement and mechanism context when separating total daily protein from meal distribution."
claimUse: context-only
directness: measurement_context
murphV1Priority: high
aliases:
  - clinicaltrials-nct03870425
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct03870425_registry** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct03870425-registry-design** — Registry record describes a 24-participant randomized controlled trial comparing even versus skewed dietary-protein distribution with 3-day myofibrillar FSR and 10-hour whole-body net protein balance endpoints; ClinicalTrials.gov has no posted results for this record.
- **finding:clinicaltrials-nct03870425-publication-linkage** — ClinicalTrials.gov links this registry record to derived publication PMID 37086618, but the registry source itself does not report the publication's effect estimates.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct03870425-protein-floor-registry-context** — Registry context for protein distribution physiology, not daily protein-floor efficacy Implication: Use for measurement and mechanism context when separating total daily protein from meal distribution.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
