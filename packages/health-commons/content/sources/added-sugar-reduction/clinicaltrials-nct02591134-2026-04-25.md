---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02591134-2026-04-25
slug: sources/added-sugar-reduction/clinicaltrials-nct02591134-2026-04-25
title: EffectS of Non-nutritive sWeetened Beverages on appetITe During aCtive weigHt Loss (SWITCH)
summary: ClinicalTrials.gov registry for the SWITCH randomized trial comparing non-nutritive sweetened beverages with water during behavioral weight loss and maintenance.
status: draft
quality: usable
aliases:
- NCT02591134
- SWITCH trial registry
- NNS beverages versus water weight-loss maintenance
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
    url: https://clinicaltrials.gov/study/NCT02591134
  canonicalUrl: https://clinicaltrials.gov/study/NCT02591134
source:
  kind: other
  title: EffectS of Non-nutritive sWeetened Beverages on appetITe During aCtive weigHt Loss (SWITCH)
  authors: ClinicalTrials.gov / University of Liverpool and collaborators
  year: 2015
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT02591134
  citation: ClinicalTrials.gov. EffectS of Non-nutritive sWeetened Beverages on appetITe During aCtive weigHt Loss (SWITCH). NCT02591134.
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Registered randomized parallel-group behavioral weight-loss and maintenance trial
  participantCount: 432
  participantCountKind: reported
  populationLabel: Adults with overweight or obesity, BMI 27-35 kg/m², consuming cold beverages
  durationLabel: 12-week weight-loss phase, 40-week assisted maintenance, and voluntary 52-week extension
  aggregateRole: context
  cohortKey: trial:SWITCH-NCT02591134
evidenceBucket: sweetener-substitution
directness: same_mechanism
claimUse: context-only
murphV1Priority: medium
artifactRightsStatusGuess: open_access
whyItMatters: Defines the planned comparator, replacement, appetite, and long-term maintenance boundaries for the SWITCH trial family.
potentialMurphEndpoints:
- Body weight
- Appetite and eating behavior
- Body composition subset
- Physical activity
- Biochemical markers
protocolTakeaway: Use as registry context only; do not cite it as evidence that NNS beverages or no-added-sugar avoidance improves outcomes.
murphTakeaway: Keep NNS beverage substitution distinct from a no-added-sugar protocol that can use water or unsweetened options without artificial sweeteners.
claimUseBoundary: Adjacent substitution design; registry is not an efficacy result source.
populationMismatch: Adults in structured behavioral weight management, not general self-directed no-added-sugar users.
limitations:
- No completed outcome data in the registry source page.
- Behavioral weight-loss support is bundled with the beverage assignment.
- NNS beverages are an adjacent replacement strategy, not required for no-added-sugar avoidance.
safetyNotes: No adverse-event result extraction from registry record.
modality: Non-nutritive sweetened beverage substitution
studyDesign: Trial registry / randomized trial protocol
---

This source is included for **sweetener-substitution**.

## Quick read

- **Source type:** Registered randomized parallel-group behavioral weight-loss and maintenance trial.
- **People studied or addressed:** Adults with overweight or obesity, BMI 27-35 kg/m², consuming cold beverages.
- **Duration or horizon:** 12-week weight-loss phase, 40-week assisted maintenance, and voluntary 52-week extension.
- **Protocol role:** context-only; directness: `same_mechanism`.

## What it contributes

Use as registry context only; do not cite it as evidence that NNS beverages or no-added-sugar avoidance improves outcomes.

## Potential Murph endpoints

Body weight, Appetite and eating behavior, Body composition subset, Physical activity, Biochemical markers

## Important limits

- Population boundary: Adults in structured behavioral weight management, not general self-directed no-added-sugar users.
- No completed outcome data in the registry source page.
- Behavioral weight-loss support is bundled with the beverage assignment.
- NNS beverages are an adjacent replacement strategy, not required for no-added-sugar avoidance.
- Safety note: No adverse-event result extraction from registry record.

## Plain-language takeaway

Keep NNS beverage substitution distinct from a no-added-sugar protocol that can use water or unsweetened options without artificial sweeteners.
