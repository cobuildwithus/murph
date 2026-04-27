---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00079573
slug: sources/high-protein-intake/clinicaltrials-nct00079573
title: "A TO Z Weight Loss Study"
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
    registryId: NCT00079573
    url: https://clinicaltrials.gov/study/NCT00079573/
  identityAliases:
    - source_artifact:clinicaltrials-nct00079573
    - NCT00079573
  canonicalUrl: https://clinicaltrials.gov/study/NCT00079573/
source:
  kind: web_page
  title: "A TO Z Weight Loss Study"
  url: https://clinicaltrials.gov/study/NCT00079573/
researchEvidence:
  designKind: other
  designLabel: "trial registry"
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: low; claimUse: context-only; directness: measurement_context"
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct00079573-registry-design
    sourceKey: source_artifact:clinicaltrials-nct00079573
    extractedFromArtifactId: art_clinicaltrials_nct00079573_registry
    findingKind: context
    population: "Overweight premenopausal women aged 30-50 years"
    exposure: "Atkins, Zone, Ornish, and guideline-style weight-loss diets"
    outcome: "Planned weight, percent body fat, blood pressure, lipid, fasting insulin/glucose, behavioral, and appetite outcomes over 1 year"
    summary: "Registry record describes a 300-participant randomized named-diet comparison in overweight premenopausal women; it does not state achieved protein dose and has no posted ClinicalTrials.gov results."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:clinicaltrials-nct00079573-publication-linkage
    sourceKey: source_artifact:clinicaltrials-nct00079573
    extractedFromArtifactId: art_clinicaltrials_nct00079573_registry
    findingKind: context
    population: "A TO Z trial participants"
    exposure: "ClinicalTrials.gov derived-publication linkage"
    outcome: "Publication linkage"
    summary: "ClinicalTrials.gov links NCT00079573 to derived JAMA publication PMID 17341711; publication results should be extracted under the publication source key rather than assigned to the registry record."
    evidenceUse:
      - context
evidenceBucket: trial_registry_context
protocolTakeaway: "Use as a boundary record showing why named low-carb/high-protein diets should not be promoted as direct protein-floor evidence."
claimUse: context-only
directness: measurement_context
murphV1Priority: low
aliases:
  - clinicaltrials-nct00079573
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct00079573_registry** — external html pointer; rights: open_access; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct00079573-registry-design** — Registry record describes a 300-participant randomized named-diet comparison in overweight premenopausal women; it does not state achieved protein dose and has no posted ClinicalTrials.gov results.
- **finding:clinicaltrials-nct00079573-publication-linkage** — ClinicalTrials.gov links NCT00079573 to derived JAMA publication PMID 17341711; publication results should be extracted under the publication source key rather than assigned to the registry record.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct00079573-protein-floor-registry-context** — Named-diet registry context, not a protein-dose trial Implication: Use as a boundary record showing why named low-carb/high-protein diets should not be promoted as direct protein-floor evidence.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
