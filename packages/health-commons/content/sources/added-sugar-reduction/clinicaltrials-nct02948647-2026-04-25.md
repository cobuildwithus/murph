---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02948647-2026-04-25
slug: sources/added-sugar-reduction/clinicaltrials-nct02948647-2026-04-25
title: Healthy Eating Through Reduction Of Excess Sugar
summary: ClinicalTrials.gov registry record for HEROES, a dietary sugar-reduction trial in obese children/Latino youth; registry context only.
status: draft
quality: usable
aliases:
- NCT02948647
- HEROES Study
- Healthy Eating Through Reduction Of Excess Sugar
categories:
- added-sugar-reduction
relations:
-
  type: related_protocol
  target: protocol_variant:added-sugar-reduction/no-added-sugar-diet
-
  type: parent_family
  target: experiment_family:added-sugar-reduction
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: https://clinicaltrials.gov/study/NCT02948647
  canonicalUrl: https://clinicaltrials.gov/study/NCT02948647
source:
  kind: other
  title: Healthy Eating Through Reduction Of Excess Sugar
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT02948647
  citation: ClinicalTrials.gov. Healthy Eating Through Reduction Of Excess Sugar. NCT02948647. Accessed 2026-04-25.
researchEvidence:
  designKind: retrospective_registry
  designLabel: Registry record for pediatric sugar-reduction randomized trial
  participantCount: 105
  participantCountKind: reported
  populationLabel: Latino youth with obesity in associated publication
  durationLabel: 12 weeks in associated publication
  aggregateRole: context
  cohortKey: clinicaltrials-nct02948647-heroes
evidenceBucket: registry-or-protocol-context
directness: clinical_supervised
claimUse: context-only
murphV1Priority: low
artifactRightsStatusGuess: open_access
whyItMatters: Connects the HEROES sugar-reduction intervention to its ClinicalTrials.gov registration and population boundary.
potentialMurphEndpoints:
- trial registration
- free sugar intake
- liver fat
- PNPLA3 subgroup context
protocolTakeaway: Use this registry to identify and bound the trial; use PMID 35218194 for outcomes.
murphTakeaway: Registry-only context; preserve pediatric/Latino/obesity boundary.
claimUseBoundary: Use for trial boundary, registration, and linkage only.
populationMismatch: Latino youth with obesity; not broad adult wellness.
limitations:
- Registry record; not an independent efficacy report.
- Pediatric clinical population.
- Associated article reports null/mixed liver outcomes.
safetyNotes: No independent safety conclusion extracted from registry source page draft.
modality: Dietary sugar reduction in pediatric/Latino obesity context
studyDesign: Trial registry record
---

This source is included for **registry-or-protocol-context**.

## Quick read

- **Source type:** Registry record for pediatric sugar-reduction randomized trial.
- **People studied or addressed:** Latino youth with obesity in associated publication.
- **Duration or horizon:** 12 weeks in associated publication.
- **Protocol role:** context-only; directness: `clinical_supervised`.

## What it contributes

Use this registry to identify and bound the trial; use PMID 35218194 for outcomes.

## Potential Murph endpoints

trial registration, free sugar intake, liver fat, PNPLA3 subgroup context

## Important limits

- Population boundary: Latino youth with obesity; not broad adult wellness.
- Registry record; not an independent efficacy report.
- Pediatric clinical population.
- Associated article reports null/mixed liver outcomes.
- Safety note: No independent safety conclusion extracted from registry source page draft.

## Plain-language takeaway

Registry-only context; preserve pediatric/Latino/obesity boundary.
