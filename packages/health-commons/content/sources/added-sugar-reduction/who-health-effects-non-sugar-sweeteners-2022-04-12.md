---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-health-effects-non-sugar-sweeteners-2022-04-12
slug: sources/added-sugar-reduction/who-health-effects-non-sugar-sweeteners-2022-04-12
title: 'Health effects of the use of non-sugar sweeteners: a systematic review and meta-analysis'
summary: The review is the evidence base context behind WHO NSS guidance and separates short-term trial signals from long-term uncertainty.
status: draft
quality: usable
aliases:
- candidate:substitution-strategies:032
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
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    url: https://www.who.int/publications/i/item/9789240046429
  canonicalUrl: https://www.who.int/publications/i/item/9789240046429
source:
  kind: review
  title: 'Health effects of the use of non-sugar sweeteners: a systematic review and meta-analysis'
  authors: Rios-Leyvraz M; Montez J; World Health Organization
  year: 2022
  journal: World Health Organization
  url: https://www.who.int/publications/i/item/9789240046429
  citation: 'Rios-Leyvraz M; Montez J; World Health Organization. Health effects of the use of non-sugar sweeteners: a systematic review and meta-analysis. World Health Organization. 2022. https://www.who.int/publications/i/item/9789240046429.'
researchEvidence:
  designKind: meta_analysis
  designLabel: Systematic review and meta-analysis
  populationLabel: Adults and children in trials and observational studies of non-sugar sweeteners
  durationLabel: WHO 2022 systematic review/meta-analysis
  aggregateRole: context
  cohortKey: source:who-health-effects-non-sugar-sweeteners-2022-04-12
evidenceBucket: safety-special-populations
directness: safety_boundary
claimUse: context-only
murphV1Priority: medium
artifactRightsStatusGuess: open_access
whyItMatters: Evidence base behind the WHO guideline; useful for separating trial versus observational signals.
potentialMurphEndpoints:
- body weight
- dietary intake
- NCD risk
- safety
protocolTakeaway: Sweetener replacement is optional and should be bounded by uncertainty rather than treated as required.
murphTakeaway: Prefer plain/unsweetened replacements; track NSS use separately if users choose it.
claimUseBoundary: Context-only evidence base for NSS guideline; not efficacy evidence.
populationMismatch: Adults and children in trials and observational studies of non-sugar sweeteners.
limitations:
- Heterogeneous evidence base.
- Exact effect estimates and adverse-event rates were not extracted here.
- NSS substitution is adjacent to added-sugar avoidance.
safetyNotes: Long-term NSS health effects and population-specific use require cautious interpretation.
modality: WHO systematic review/meta-analysis
studyDesign: Systematic review and meta-analysis
---

This source is included for **safety-special-populations**.

## Quick read

- **Source type:** Systematic review and meta-analysis.
- **People studied or addressed:** Adults and children in trials and observational studies of non-sugar sweeteners.
- **Duration or horizon:** WHO 2022 systematic review/meta-analysis.
- **Protocol role:** context-only; directness: `safety_boundary`.

## What it contributes

Sweetener replacement is optional and should be bounded by uncertainty rather than treated as required.

## Potential Murph endpoints

body weight, dietary intake, NCD risk, safety

## Important limits

- Population boundary: Adults and children in trials and observational studies of non-sugar sweeteners.
- Heterogeneous evidence base.
- Exact effect estimates and adverse-event rates were not extracted here.
- NSS substitution is adjacent to added-sugar avoidance.
- Safety note: Long-term NSS health effects and population-specific use require cautious interpretation.

## Plain-language takeaway

Prefer plain/unsweetened replacements; track NSS use separately if users choose it.
