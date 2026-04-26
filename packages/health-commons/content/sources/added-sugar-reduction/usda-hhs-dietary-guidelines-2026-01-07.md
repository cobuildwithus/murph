---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:usda-hhs-dietary-guidelines-2026-01-07
slug: sources/added-sugar-reduction/usda-hhs-dietary-guidelines-2026-01-07
title: Dietary Guidelines for Americans, 2025-2030
summary: Current U.S. Dietary Guidelines source for added-sugar, refined-carbohydrate, and highly processed food public-health framing.
status: draft
quality: usable
aliases:
- Dietary Guidelines for Americans 2025-2030
- USDA HHS DGA 2026
- Eat real food DGA
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
    url: https://www.dietaryguidelines.gov/
  canonicalUrl: https://www.dietaryguidelines.gov/
source:
  kind: guideline
  title: Dietary Guidelines for Americans, 2025-2030
  authors: U.S. Department of Agriculture; U.S. Department of Health and Human Services
  year: 2026
  journal: Dietary Guidelines for Americans
  url: https://www.dietaryguidelines.gov/
  citation: U.S. Department of Agriculture and U.S. Department of Health and Human Services. Dietary Guidelines for Americans, 2025-2030. 2026.
researchEvidence:
  designKind: guideline
  designLabel: U.S. federal dietary guideline
  populationLabel: U.S. general population guidance context
  durationLabel: 2025-2030 policy period
  aggregateRole: context
  cohortKey: guideline:usda-hhs-dga-2025-2030
evidenceBucket: guidelines-and-synthesis
directness: same_mechanism
claimUse: supports-protocol
murphV1Priority: high
artifactRightsStatusGuess: open_access
whyItMatters: Provides current U.S. guideline framing and the public-health context most likely to inform U.S. users.
potentialMurphEndpoints:
- Added sugars intake
- Sugar-sweetened beverages
- Refined carbohydrates
- Highly processed foods
protocolTakeaway: Use as U.S. guideline context, preserving that it is not a controlled trial and may differ from WHO/SACN free-sugar thresholds.
murphTakeaway: Protocol copy should not mix U.S. added-sugar framing with WHO/SACN free-sugar thresholds without explaining the definitions.
claimUseBoundary: U.S. guideline source; threshold details require current DGA-text verification before user-facing dose claims.
populationMismatch: Population-level guidance, not individual self-experiment evidence.
limitations:
- Guideline rather than trial evidence.
- Jurisdiction-specific U.S. policy source.
- The source uses added-sugar and broader diet-pattern framing that must be separated from free-sugars evidence.
safetyNotes: No adverse-event data extracted.
modality: U.S. dietary-pattern guidance
studyDesign: Guideline
---

This source is included for **guidelines-and-synthesis**.

## Quick read

- **Source type:** U.S. federal dietary guideline.
- **People studied or addressed:** U.S. general population guidance context.
- **Duration or horizon:** 2025-2030 policy period.
- **Protocol role:** supports-protocol; directness: `same_mechanism`.

## What it contributes

Use as U.S. guideline context, preserving that it is not a controlled trial and may differ from WHO/SACN free-sugar thresholds.

## Potential Murph endpoints

Added sugars intake, Sugar-sweetened beverages, Refined carbohydrates, Highly processed foods

## Important limits

- Population boundary: Population-level guidance, not individual self-experiment evidence.
- Guideline rather than trial evidence.
- Jurisdiction-specific U.S. policy source.
- The source uses added-sugar and broader diet-pattern framing that must be separated from free-sugars evidence.
- Safety note: No adverse-event data extracted.

## Plain-language takeaway

Protocol copy should not mix U.S. added-sugar framing with WHO/SACN free-sugar thresholds without explaining the definitions.
