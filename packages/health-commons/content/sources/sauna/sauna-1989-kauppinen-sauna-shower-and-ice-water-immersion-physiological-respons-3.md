---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-3
slug: sources/sauna/sauna-1989-kauppinen-sauna-shower-and-ice-water-immersion-physiological-respons-3
title: "Sauna, shower, and ice water immersion. Physiological responses to brief exposures to heat, cool, and cold. Part III. Body temperatures"
summary: "This companion physiology study measured body-temperature responses across sauna, shower, and ice-water exposure. The main finding is that heat and cold sequencing changes thermal load, not just subjective comfort. For Murph, it supports tracking temperature, duration, cooldown, and symptoms."
status: draft
quality: usable
categories:
  - sauna
  - study
  - general-mixed
relations:
  -
    type: related_protocol
    target: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: journal_article
  title: "Sauna, shower, and ice water immersion. Physiological responses to brief exposures to heat, cool, and cold. Part III. Body temperatures"
  authors: "Kauppinen K"
  year: 1989
  journal: "Arctic Med Res"
  citation: "Kauppinen K. Sauna, shower, and ice water immersion. Physiological responses to brief exposures to heat, cool, and cold. Part III. Body temperatures. Arctic Med Res 1989;48:75-86."
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "Thermal-sequence body-temperature study"
  participantCount: 8
  participantCountKind: "approximate"
  populationLabel: "Healthy adult volunteers"
  durationLabel: "Brief sauna/shower/ice-water exposures"
  aggregateRole: "primary"
  aggregationNote: "Approximate count; same volunteer series as companion 1989 Kauppinen papers."
  cohortKey: "kauppinen-1989-sauna-shower-ice-water-volunteers"
protocolEvidence:
  -
    protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    groupId: near-term-autonomic-vascular-and-immune-signals
    stance: supports
    scope: direct_protocol
    result: not_efficacy_evidence
    headline: "This companion physiology study measured body-temperature responses across sauna, shower, and ice-water exposure. The main finding is that heat and cold sequencing changes thermal load, not just subjective comfort."
    implication: "This source supports tracking temperature, duration, cooldown, and symptoms."
    caveat: "Acute mechanistic responses explain the heat load but are not direct repeated-protocol efficacy outcomes."
    displayPriority: 50
  -
    protocolKey: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
    groupId: safety-dose-modality-and-context-boundaries
    stance: safety_boundary
    scope: adjacent_variant
    result: not_efficacy_evidence
    headline: "This sauna-plus-cold body-temperature study reinforces conservative duration, cooldown, and symptom stop rules when mixed thermal exposures are layered together."
    implication: "Use it to justify explicit temperature, cooldown, and stop-condition guardrails instead of silently merging cold exposure into the default sauna plan."
    caveat: "Acute body-temperature physiology with cold exposure informs safety boundaries, not repeated-protocol efficacy."
    displayPriority: 120
evidenceBucket: Finnish dry-sauna corpus
whyItMatters: "Expands the audited Finnish dry-sauna evidence corpus with a general / mixed record marked lower priority for Murph v1 interpretation."
potentialMurphEndpoints:
  - safety screening
  - session tolerance
  - illness and respiratory context
protocolTakeaway: "Use as supporting corpus context; do not convert directly into promised short-term wearable outcomes."
murphTakeaway: "This source supports tracking temperature, duration, cooldown, and symptoms."
studyDesign: "Experimental physiology"
modality: "Sauna (unspecified / likely dry)"
finnishDrySaunaFocus: "Likely"
murphV1Priority: "Lower"
sourceUrlCurationNote: Workbook source URL points to a bibliography or review backbone rather than a direct article landing page, so the public source link is intentionally omitted from the app card.
---

This source is part of Murph's audited Finnish dry-sauna yes/likely corpus.

**Findings:** This companion physiology study measured body-temperature responses across sauna, shower, and ice-water exposure. The main finding is that heat and cold sequencing changes thermal load, not just subjective comfort.

**Why it matters:** Expands the audited Finnish dry-sauna evidence corpus with a general / mixed record marked lower priority for Murph v1 interpretation.

**Potential Murph endpoints/context:** safety screening, session tolerance, illness and respiratory context

**Protocol takeaway:** Use as supporting corpus context; do not convert directly into promised short-term wearable outcomes.

The workbook linked this record through a review or bibliography backbone rather than a direct article page. Keep it in the corpus, but do not show a potentially misleading outbound source link in the product UI.
