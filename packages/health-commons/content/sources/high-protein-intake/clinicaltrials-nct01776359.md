---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01776359
slug: sources/high-protein-intake/clinicaltrials-nct01776359
title: "High Protein Intake and Intense Exercise During Weight Loss"
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
    registryId: NCT01776359
    url: https://clinicaltrials.gov/study/NCT01776359/
  identityAliases:
    - source_artifact:clinicaltrials-nct01776359
    - NCT01776359
  canonicalUrl: https://clinicaltrials.gov/study/NCT01776359/
source:
  kind: web_page
  title: "High Protein Intake and Intense Exercise During Weight Loss"
  authors: McMaster University
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT01776359/
researchEvidence:
  designKind: other
  designLabel: "trial registry"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: medium; claimUse: context-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct01776359-registry-design
    sourceKey: source_artifact:clinicaltrials-nct01776359
    extractedFromArtifactId: art_clinicaltrials_nct01776359_registry
    findingKind: context
    population: "Healthy young men aged 18-30 years undergoing 40% energy deficit and 6 days/week high-intensity training"
    exposure: "2.4 g/kg/day protein versus 1.2 g/kg/day protein"
    outcome: "Planned body-composition and psychological-state outcomes over 4 weeks"
    summary: "Registry record describes a 40-participant randomized trial comparing 2.4 versus 1.2 g/kg/day protein during 4 weeks of severe energy deficit and intense exercise; no ClinicalTrials.gov results are posted."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:clinicaltrials-nct01776359-publication-linkage
    sourceKey: source_artifact:clinicaltrials-nct01776359
    extractedFromArtifactId: art_clinicaltrials_nct01776359_registry
    findingKind: context
    population: "RIPPED trial participants"
    exposure: "ClinicalTrials.gov derived-publication linkage"
    outcome: "Publication linkage"
    summary: "ClinicalTrials.gov links the registry record to derived publication PMID 26817506, but the publication's effect estimates should be extracted under its own source key, not imported into the registry artifact."
    evidenceUse:
      - context
evidenceBucket: trial_registry_context
protocolTakeaway: "Useful for noting that high-protein targets have been studied under severe supervised energy deficit and intense training, not as a simple floor protocol."
claimUse: context-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - clinicaltrials-nct01776359
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct01776359_registry** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct01776359-registry-design** — Registry record describes a 40-participant randomized trial comparing 2.4 versus 1.2 g/kg/day protein during 4 weeks of severe energy deficit and intense exercise; no ClinicalTrials.gov results are posted.
- **finding:clinicaltrials-nct01776359-publication-linkage** — ClinicalTrials.gov links the registry record to derived publication PMID 26817506, but the publication's effect estimates should be extracted under its own source key, not imported into the registry artifact.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct01776359-protein-floor-registry-context** — Adjacent high-dose protein plus intense-training registry context Implication: Useful for noting that high-protein targets have been studied under severe supervised energy deficit and intense training, not as a simple floor protocol.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
