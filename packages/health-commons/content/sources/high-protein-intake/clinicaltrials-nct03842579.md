---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03842579
slug: sources/high-protein-intake/clinicaltrials-nct03842579
title: "Protein and Exercise to Counteract Frailty in Older Adults"
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
    registryId: NCT03842579
    url: https://clinicaltrials.gov/study/NCT03842579/
  identityAliases:
    - source_artifact:clinicaltrials-nct03842579
    - NCT03842579
  canonicalUrl: https://clinicaltrials.gov/study/NCT03842579/
source:
  kind: web_page
  title: "Protein and Exercise to Counteract Frailty in Older Adults"
  authors: "University of Southern Denmark"
  journal: "ClinicalTrials.gov"
  url: https://clinicaltrials.gov/study/NCT03842579/
researchEvidence:
  designKind: other
  designLabel: "trial registry"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: medium; claimUse: context-only; directness: measurement_context"
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct03842579-registry-design
    sourceKey: source_artifact:clinicaltrials-nct03842579
    extractedFromArtifactId: art_clinicaltrials_nct03842579_registry
    findingKind: context
    population: "Pre-frail or frail community-dwelling adults aged ≥80 years"
    exposure: "Protein-only 1.5 g/kg/day, exercise plus 1.5 g/kg/day protein, or recommendations targeting 1.0-1.3 g/kg/day"
    outcome: "Planned muscle power, frailty, function, body composition, dietary-intake, and blood-marker outcomes over 4 months"
    summary: "Registry record describes a planned 150-participant two-phase randomized trial in adults ≥80 years, including protein-only and exercise-plus-protein arms targeting 1.5 g/kg/day, but ClinicalTrials.gov status is unknown and no results are posted."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:clinicaltrials-nct03842579-publication-linkage
    sourceKey: source_artifact:clinicaltrials-nct03842579
    extractedFromArtifactId: art_clinicaltrials_nct03842579_registry
    findingKind: context
    population: "Pre-frail or frail community-dwelling older adults"
    exposure: "ClinicalTrials.gov derived-publication linkage"
    outcome: "Publication linkage"
    summary: "ClinicalTrials.gov links NCT03842579 to protocol publication PMID 32653012; protocol details should not be treated as outcome evidence."
    evidenceUse:
      - context
evidenceBucket: trial_registry_context
protocolTakeaway: "Useful for endpoint selection and older-adult safety/adherence boundaries when considering 1.5 g/kg/day targets."
claimUse: context-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - clinicaltrials-nct03842579
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct03842579_registry** — external html pointer; rights: unknown; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct03842579-registry-design** — Registry record describes a planned 150-participant two-phase randomized trial in adults ≥80 years, including protein-only and exercise-plus-protein arms targeting 1.5 g/kg/day, but ClinicalTrials.gov status is unknown and no results are posted.
- **finding:clinicaltrials-nct03842579-publication-linkage** — ClinicalTrials.gov links NCT03842579 to protocol publication PMID 32653012; protocol details should not be treated as outcome evidence.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct03842579-protein-floor-registry-context** — Supervised older-adult 1.5 g/kg/day registry design without posted results Implication: Useful for endpoint selection and older-adult safety/adherence boundaries when considering 1.5 g/kg/day targets.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
