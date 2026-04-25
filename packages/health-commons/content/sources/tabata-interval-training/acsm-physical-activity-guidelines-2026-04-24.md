---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:acsm-physical-activity-guidelines-2026-04-24
slug: sources/tabata-interval-training/acsm-physical-activity-guidelines-2026-04-24
title: Physical Activity Guidelines
summary: ACSM physical-activity guideline page used as background dose context so a four-minute Tabata-style workout is not framed as a full replacement for broader weekly aerobic and resistance-activity recommendations.
status: draft
quality: usable
aliases:
  - ACSM Physical Activity Guidelines
  - American College of Sports Medicine physical activity guidelines
  - accessed 2026-04-24
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
source:
  kind: guideline
  title: Physical Activity Guidelines
  authors: American College of Sports Medicine
  year: 2026
  journal: American College of Sports Medicine
  url: https://acsm.org/education-resources/trending-topics-resources/physical-activity-guidelines/
  citation: American College of Sports Medicine. Physical Activity Guidelines. Accessed 2026-04-24. https://acsm.org/education-resources/trending-topics-resources/physical-activity-guidelines/.
researchEvidence:
  designKind: guideline
  designLabel: Public physical-activity guideline and background dose context
  populationLabel: General adults; guideline context rather than a participant cohort
  durationLabel: Weekly physical-activity dose guidance
  cohortKey: acsm-physical-activity-guidelines:adults
  aggregateRole: context
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: background_context
    stance: context_only
    scope: general_guideline
    result: not_efficacy_evidence
    endpointKeys: []
    headline: Guideline context: short workouts should not be over-positioned as a complete activity plan.
    implication: Use to frame Tabata 20/10 as a possible exercise component rather than a standalone replacement for weekly activity recommendations.
    caveat: This is not Tabata efficacy evidence and does not test any 20/10 protocol.
    displayPriority: 50
evidenceBucket: background_context
whyItMatters: It gives a conservative dose boundary for public-facing claims about four-minute workouts.
potentialMurphEndpoints:
  - weekly vigorous minutes
  - weekly moderate minutes
  - strength-training days
  - exercise adherence
protocolTakeaway: Use only as background guideline context.
murphTakeaway: Murph should avoid implying that a single four-minute Tabata block satisfies full weekly health-guideline targets.
studyDesign: Guideline/background source
modality: General aerobic and muscle-strengthening physical activity
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-008
---
This source is included for **background_context**.

**Findings:** ACSM guideline context recommends broader weekly aerobic and muscle-strengthening activity; this source does not test Tabata or any interval-training protocol (`source_artifact:acsm-physical-activity-guidelines-2026-04-24`).

**Why it matters:** It provides a dose boundary so Tabata 20/10 is not over-positioned as a complete replacement for weekly activity guidance (`source_artifact:acsm-physical-activity-guidelines-2026-04-24`).

**Potential experiment signals:** Weekly moderate/vigorous minutes, strength-training days, and total activity volume.

**Protocol takeaway:** Background only; not efficacy evidence.

**Claim use:** `context-only`.
