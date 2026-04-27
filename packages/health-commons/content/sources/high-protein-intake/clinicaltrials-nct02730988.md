---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02730988
slug: sources/high-protein-intake/clinicaltrials-nct02730988
title: "Effect of High Protein Weight Loss for Seniors"
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
    registryId: NCT02730988
    url: https://clinicaltrials.gov/study/NCT02730988/
  identityAliases:
    - source_artifact:clinicaltrials-nct02730988
    - NCT02730988
  canonicalUrl: https://clinicaltrials.gov/study/NCT02730988/
source:
  kind: web_page
  title: "Effect of High Protein Weight Loss for Seniors"
  url: https://clinicaltrials.gov/study/NCT02730988/
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  aggregateRole: context
  notes:
    - "Canonical ledger batch: batch-015; priority: medium; claimUse: context-only; directness: measurement_context"
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct02730988-registry-design
    sourceKey: source_artifact:clinicaltrials-nct02730988
    findingKind: context
    population: "Adults aged 65-79 years with obesity and mobility-disability risk"
    exposure: "High-protein 1200 kcal Medifast weight-loss lifestyle counseling targeting about 10% weight loss and ≥1.0 g/kg/day protein"
    outcome: "Planned 400-meter gait speed and lean-mass outcomes over 24 weeks"
    summary: "Registry record describes a 96-participant randomized trial comparing higher-protein hypocaloric weight-loss counseling with weight-stable lifestyle counseling in older adults with obesity and mobility-disability risk."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:clinicaltrials-nct02730988-registry-outcomes
    sourceKey: source_artifact:clinicaltrials-nct02730988
    findingKind: intervention_result
    population: "Older adults with obesity and paired follow-up testing"
    exposure: "High-protein hypocaloric weight-loss lifestyle counseling versus weight-stable counseling"
    outcome: "400-meter gait speed and lean mass at 24 weeks"
    summary: "Posted registry results report 400-meter gait-speed change of 0.01 m/s (95% CI -0.02 to 0.04; n=42) in the weight-loss group versus -0.02 m/s (95% CI -0.05 to 0.01; n=38) in controls, and lean-mass change of -0.81 kg (95% CI -1.40 to -0.23; n=41) versus -0.24 kg (95% CI -0.85 to 0.36; n=39)."
    evidenceUse:
      - efficacy
      - adjacent_variant
  -
    findingId: finding:clinicaltrials-nct02730988-registry-safety
    sourceKey: source_artifact:clinicaltrials-nct02730988
    findingKind: adverse_event
    population: "Randomized older adults with obesity"
    exposure: "High-protein hypocaloric weight-loss lifestyle counseling versus weight-stable counseling"
    outcome: "Deaths, serious adverse events, and other adverse events over 6 months"
    summary: "Posted registry safety table reports 0 deaths in both groups, serious adverse events in 2/47 weight-loss participants and 2/49 controls, and other adverse events in 5/47 weight-loss participants and 5/49 controls; digestive events were 4/47 versus 2/49 and musculoskeletal events were 1/47 versus 3/49."
    evidenceUse:
      - safety
      - adjacent_variant
evidenceBucket: trial_registry_context
protocolTakeaway: "Use as supervised older-adult weight-loss and safety context, especially for function, lean mass, and adverse-event monitoring."
claimUse: context-only
directness: measurement_context
murphV1Priority: medium
aliases:
  - clinicaltrials-nct02730988
---

This source page was materialized from the Protein Floor canonical source ledger and extraction findings. It stores metadata and source-owned findings only; no copyrighted PDFs or full text are committed.

## Quick read

- **Role in this package:** context-only (measurement_context).
- **Evidence bucket:** trial_registry_context.
- **Extraction batch:** batch-015.

## Artifact pointer

- **art_clinicaltrials_nct02730988_protocol_sap_pdf** — external html pointer; rights: unknown; redistributable: False

## Extracted findings

- **finding:clinicaltrials-nct02730988-registry-design** — Registry record describes a 96-participant randomized trial comparing higher-protein hypocaloric weight-loss counseling with weight-stable lifestyle counseling in older adults with obesity and mobility-disability risk.
- **finding:clinicaltrials-nct02730988-registry-outcomes** — Posted registry results report 400-meter gait-speed change of 0.01 m/s (95% CI -0.02 to 0.04; n=42) in the weight-loss group versus -0.02 m/s (95% CI -0.05 to 0.01; n=38) in controls, and lean-mass change of -0.81 kg (95% CI -1.40 to -0.23; n=41) versus -0.24 kg (95% CI -0.85 to 0.36; n=39).
- **finding:clinicaltrials-nct02730988-registry-safety** — Posted registry safety table reports 0 deaths in both groups, serious adverse events in 2/47 weight-loss participants and 2/49 controls, and other adverse events in 5/47 weight-loss participants and 5/49 controls; digestive events were 4/47 versus 2/49 and musculoskeletal events were 1/47 versus 3/49.

## Protocol appraisal

- **evidence_appraisal:clinicaltrials-nct02730988-protein-floor-registry-context** — Older-adult higher-protein weight-loss registry results are adjacent and mixed Implication: Use as supervised older-adult weight-loss and safety context, especially for function, lean mass, and adverse-event monitoring.

## Use boundaries

Use this page according to the claim-use, directness, finding IDs, and appraisal key above. Adjacent, context-only, mixed, null, negative, and safety-boundary findings must remain visibly separated from direct protocol efficacy claims.
