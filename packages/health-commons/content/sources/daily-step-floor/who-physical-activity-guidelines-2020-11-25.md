---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:who-physical-activity-guidelines-2020-11-25
slug: sources/daily-step-floor/who-physical-activity-guidelines-2020-11-25
title: WHO guidelines on physical activity and sedentary behaviour
summary: Official WHO guideline publication for physical activity and sedentary behaviour; context-only for Daily Step Floor.
status: draft
quality: usable
aliases:
- WHO guidelines on physical activity and sedentary behaviour 2020 official publication
- who-physical-activity-guidelines-2020-11-25
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: guideline
  title: WHO guidelines on physical activity and sedentary behaviour
  authors: World Health Organization
  year: 2020
  journal: World Health Organization
  url: https://www.who.int/publications/i/item/9789240015128
  citation: 'World Health Organization. WHO guidelines on physical activity and sedentary behaviour. Geneva: World Health Organization; 2020. Licence: CC BY-NC-SA 3.0 IGO.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    titleHash: de9cf40ef8e08ab943bf6e7f3df46dd375aaef029cebeff598e8b5edc55e0bbe
    url: https://www.who.int/publications/i/item/9789240015128
  canonicalUrl: https://www.who.int/publications/i/item/9789240015128
researchEvidence:
  designKind: guideline
  designLabel: WHO official guideline publication
  populationLabel: Children, adolescents, adults, older adults, pregnant and postpartum women, and people living with chronic conditions or disability.
  durationLabel: Not applicable; guideline document.
  cohortKey: cohort:daily-step-floor/who-physical-activity-guidelines-2020-11-25
  aggregateRole: primary
evidenceBucket: guidelines_external_protocol_context
whyItMatters: Anchors the protocol in globally recognized activity guidance while preserving the boundary that WHO does not prescribe this specific step-floor protocol.
potentialMurphEndpoints:
- physical_activity_minutes
- sedentary_time
- muscle_strengthening
- daily_step_count
protocolTakeaway: Use as context-only global guideline evidence and safety/special-population framing.
murphTakeaway: A Murph step-floor protocol should align with WHO “some is better than none” and sedentary-reduction framing without claiming WHO validation of a step floor.
studyDesign: guideline
modality: physical_activity_guideline_context
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/who-physical-activity-guidelines-2020-11-25/context
  sourceKey: source_artifact:who-physical-activity-guidelines-2020-11-25
  extractedFromArtifactId: art_who_physical_activity_guidelines_2020_11_25_source_extract
  findingKind: context
  population: Children, adolescents, adults, older adults, pregnant and postpartum women, and people living with chronic conditions or disability.
  exposure: Official WHO evidence-based public-health recommendations on physical activity and sedentary behaviour; not a step-count protocol.
  outcome: physical activity frequency, intensity, duration and type; sedentary behaviour; health risks and benefits
  summary: The official WHO 2020 guideline gives evidence-based recommendations for physical activity and sedentary behaviour across population groups; it is not an efficacy test of a Daily Step Floor.
  evidenceUse:
  - context
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **guidelines_external_protocol_context**.

**Findings:** The official WHO 2020 guideline gives evidence-based recommendations for physical activity and sedentary behaviour across population groups; it is not an efficacy test of a Daily Step Floor.

**Why it matters:** Anchors the protocol in globally recognized activity guidance while preserving the boundary that WHO does not prescribe this specific step-floor protocol.

**Potential experiment signals:** physical_activity_minutes, sedentary_time, muscle_strengthening, daily_step_count.

**Protocol takeaway:** Use as context-only global guideline evidence and safety/special-population framing.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Children, adolescents, adults, older adults, pregnant and postpartum women, and people living with chronic conditions or disability.
- **Exposure/intervention:** Official WHO evidence-based public-health recommendations on physical activity and sedentary behaviour; not a step-count protocol.
- **Comparator/control:** No comparator or control group; guideline document.
- **Duration/follow-up:** Not applicable; guideline document.
- **Endpoints:** physical activity frequency, intensity, duration and type; sedentary behaviour; health risks and benefits
- **Effect estimates or direction:** Provides official WHO recommendations for activity and sedentary behaviour by population group; no daily step-floor effect estimate is reported.
- **Adverse events/safety notes:** Guideline includes benefits/harms framing and special-population considerations; no source-specific adverse-event dataset.
- **Limitations:** Guideline context only; recommendations are not operationalized as a personal daily step floor.
- **Population mismatch:** Global guideline document, not a wearable-tracked step-floor intervention.
- **Artifact rights:** open_access
