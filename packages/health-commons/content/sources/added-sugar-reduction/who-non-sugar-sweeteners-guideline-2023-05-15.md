---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-non-sugar-sweeteners-guideline-2023-05-15
slug: sources/added-sugar-reduction/who-non-sugar-sweeteners-guideline-2023-05-15
title: 'Use of non-sugar sweeteners: WHO guideline'
summary: WHO guideline is a key safety boundary against making NSS replacement the default adherence strategy.
status: draft
quality: usable
aliases:
- candidate:behavioral-adherence:039
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
    url: https://www.who.int/publications/i/item/9789240073616
  canonicalUrl: https://www.who.int/publications/i/item/9789240073616
source:
  kind: guideline
  title: 'Use of non-sugar sweeteners: WHO guideline'
  authors: World Health Organization
  year: 2023
  journal: World Health Organization
  url: https://www.who.int/publications/i/item/9789240073616
  citation: 'World Health Organization. Use of non-sugar sweeteners: WHO guideline. World Health Organization. 2023. https://www.who.int/publications/i/item/9789240073616.'
researchEvidence:
  designKind: guideline
  designLabel: Guideline
  populationLabel: Adults and children, with specified exclusions in the guideline
  durationLabel: 2023 WHO guideline
  aggregateRole: context
  cohortKey: source:who-non-sugar-sweeteners-guideline-2023-05-15
evidenceBucket: safety-special-populations
directness: safety_boundary
claimUse: safety-only
murphV1Priority: high
artifactRightsStatusGuess: open_access
whyItMatters: Safety/boundary source when adherence strategies propose replacing added sugar with non-sugar sweeteners.
potentialMurphEndpoints:
- sweetener substitution
- safety boundary
- weight management
- long-term health outcomes
protocolTakeaway: Do not build the no-added-sugar protocol around NSS substitution.
murphTakeaway: Use WHO NSS guidance as a substitution boundary, not a condemnation of all incidental NSS exposure.
claimUseBoundary: NSS substitution safety boundary.
populationMismatch: Adults and children within WHO guideline scope, with specified exclusions.
limitations:
- Guideline recommendation is conditional.
- Specified exclusions must be preserved.
- Not a no-added-sugar efficacy study.
safetyNotes: NSS substitution decisions may differ for diabetes, pregnancy, children, and therapeutic contexts depending on guideline scope and clinician advice.
modality: WHO non-sugar sweetener guideline
studyDesign: Guideline
---

This source is included for **safety-special-populations**.

## Quick read

- **Source type:** Guideline.
- **People studied or addressed:** Adults and children, with specified exclusions in the guideline.
- **Duration or horizon:** 2023 WHO guideline.
- **Protocol role:** safety-only; directness: `safety_boundary`.

## What it contributes

Do not build the no-added-sugar protocol around NSS substitution.

## Potential Murph endpoints

sweetener substitution, safety boundary, weight management, long-term health outcomes

## Important limits

- Population boundary: Adults and children within WHO guideline scope, with specified exclusions.
- Guideline recommendation is conditional.
- Specified exclusions must be preserved.
- Not a no-added-sugar efficacy study.
- Safety note: NSS substitution decisions may differ for diabetes, pregnancy, children, and therapeutic contexts depending on guideline scope and clinician advice.

## Plain-language takeaway

Use WHO NSS guidance as a substitution boundary, not a condemnation of all incidental NSS exposure.
