---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-added-sugars-label-2026-03-04
slug: sources/added-sugar-reduction/fda-added-sugars-label-2026-03-04
title: Added Sugars on the Nutrition Facts Label
summary: FDA label-literacy page explaining added-sugars declarations, percent Daily Value, and 50 g/day reference value on a 2,000-calorie diet.
status: draft
quality: usable
aliases:
- FDA Added Sugars Nutrition Facts Label
- FDA added sugars label 2026
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
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.fda.gov/food/nutrition-facts-label/added-sugars-nutrition-facts-label
  canonicalUrl: https://www.fda.gov/food/nutrition-facts-label/added-sugars-nutrition-facts-label
source:
  kind: web_page
  title: Added Sugars on the Nutrition Facts Label
  authors: U.S. Food and Drug Administration
  year: 2026
  journal: FDA
  url: https://www.fda.gov/food/nutrition-facts-label/added-sugars-nutrition-facts-label
  citation: U.S. Food and Drug Administration. Added Sugars on the Nutrition Facts Label. 2026.
researchEvidence:
  designKind: other
  designLabel: FDA consumer label-education page
  populationLabel: U.S. consumers using packaged-food labels
  durationLabel: Current label education
  aggregateRole: context
  cohortKey: web:fda-added-sugars-label-2026
evidenceBucket: web-and-label-context
directness: background
claimUse: context-only
murphV1Priority: low
artifactRightsStatusGuess: open_access
whyItMatters: Turns added-sugar reduction into a concrete label-reading action for packaged foods.
potentialMurphEndpoints:
- Added sugars grams
- Percent Daily Value
- Nutrition Facts label use
- Ingredient-source awareness
protocolTakeaway: Use to teach label checking and avoid confusing total sugars with added sugars.
murphTakeaway: For adherence, users can track added sugars in grams and percent Daily Value on labels, while whole-food choices may require other cues.
claimUseBoundary: Implementation and labeling source only; not efficacy evidence.
populationMismatch: U.S. packaged-food label context only.
limitations:
- Not primary research.
- Daily Value is based on a reference calorie level and not individualized.
- Does not cover all non-packaged foods or free-sugar definitions.
safetyNotes: No adverse-event data extracted.
modality: Nutrition Facts label education
studyDesign: Public-health web page
---

This source is included for **web-and-label-context**.

## Quick read

- **Source type:** FDA consumer label-education page.
- **People studied or addressed:** U.S. consumers using packaged-food labels.
- **Duration or horizon:** Current label education.
- **Protocol role:** context-only; directness: `background`.

## What it contributes

Use to teach label checking and avoid confusing total sugars with added sugars.

## Potential Murph endpoints

Added sugars grams, Percent Daily Value, Nutrition Facts label use, Ingredient-source awareness

## Important limits

- Population boundary: U.S. packaged-food label context only.
- Not primary research.
- Daily Value is based on a reference calorie level and not individualized.
- Does not cover all non-packaged foods or free-sugar definitions.
- Safety note: No adverse-event data extracted.

## Plain-language takeaway

For adherence, users can track added sugars in grams and percent Daily Value on labels, while whole-food choices may require other cues.
