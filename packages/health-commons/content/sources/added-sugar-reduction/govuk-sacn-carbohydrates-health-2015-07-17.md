---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:govuk-sacn-carbohydrates-health-2015-07-17
slug: sources/added-sugar-reduction/govuk-sacn-carbohydrates-health-2015-07-17
title: SACN Carbohydrates and Health Report
summary: UK SACN carbohydrate guideline and evidence review that sets a population free-sugars target and separates free sugars from added sugars terminology.
status: draft
quality: usable
aliases:
- SACN 2015 carbohydrates and health
- UK free sugars 5% dietary energy guidance
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
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    url: https://www.gov.uk/government/publications/sacn-carbohydrates-and-health-report
  canonicalUrl: https://www.gov.uk/government/publications/sacn-carbohydrates-and-health-report
source:
  kind: guideline
  title: SACN Carbohydrates and Health Report
  authors: Scientific Advisory Committee on Nutrition
  year: 2015
  journal: UK Government / Scientific Advisory Committee on Nutrition
  url: https://www.gov.uk/government/publications/sacn-carbohydrates-and-health-report
  citation: Scientific Advisory Committee on Nutrition. SACN Carbohydrates and Health Report. UK Government; 2015.
researchEvidence:
  designKind: guideline
  designLabel: UK public-health guideline and evidence review
  populationLabel: UK population guidance context
  durationLabel: Life-course public-health guidance
  aggregateRole: synthesis
  cohortKey: guideline:uk-sacn-carbohydrates-health-2015
evidenceBucket: guidelines-and-synthesis
directness: same_mechanism
claimUse: supports-protocol
murphV1Priority: backbone
artifactRightsStatusGuess: open_access
whyItMatters: Provides a clear UK free-sugars threshold and public-health framing for dental and weight-related guardrails.
potentialMurphEndpoints:
- Free sugars as percent dietary energy
- Sugar-sweetened beverage intake
- Dental caries context
- Body weight context
protocolTakeaway: Use SACN for threshold context and terminology, not as direct proof that a no-added-sugar self-experiment improves biomarkers.
murphTakeaway: If using a strict no-added-sugar target, distinguish free sugars from added sugars and keep beverage minimization separate from total diet claims.
claimUseBoundary: Threshold/context source only; preserve UK jurisdiction and free-sugars definition.
populationMismatch: Population-level UK guidance, not an individual no-added-sugar trial.
limitations:
- Guideline-level synthesis, not direct protocol evidence.
- Free sugars are broader than added sugars because fruit juice, honey, and syrups are included.
- Population-average recommendation may not map cleanly to a personal elimination protocol.
safetyNotes: No adverse-event extraction; use for public-health guardrails rather than safety claims.
modality: Free-sugars public-health guidance
studyDesign: Guideline and evidence review
---

This source is included for **guidelines-and-synthesis**.

## Quick read

- **Source type:** UK public-health guideline and evidence review.
- **People studied or addressed:** UK population guidance context.
- **Duration or horizon:** Life-course public-health guidance.
- **Protocol role:** supports-protocol; directness: `same_mechanism`.

## What it contributes

Use SACN for threshold context and terminology, not as direct proof that a no-added-sugar self-experiment improves biomarkers.

## Potential Murph endpoints

Free sugars as percent dietary energy, Sugar-sweetened beverage intake, Dental caries context, Body weight context

## Important limits

- Population boundary: Population-level UK guidance, not an individual no-added-sugar trial.
- Guideline-level synthesis, not direct protocol evidence.
- Free sugars are broader than added sugars because fruit juice, honey, and syrups are included.
- Population-average recommendation may not map cleanly to a personal elimination protocol.
- Safety note: No adverse-event extraction; use for public-health guardrails rather than safety claims.

## Plain-language takeaway

If using a strict no-added-sugar target, distinguish free sugars from added sugars and keep beverage minimization separate from total diet claims.
