---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:blood-ketones-beta-hydroxybutyrate
slug: biomarkers/blood-ketones-beta-hydroxybutyrate
title: Blood Ketones / Beta-Hydroxybutyrate
summary: An optional fasting ketosis marker that can confirm fuel-switching context but should not be treated as an efficacy target or as ketoacidosis clearance.
status: draft
quality: usable
aliases:
  - BHB
  - beta-hydroxybutyrate
  - blood ketones
  - fasting ketones
categories:
  - metabolic-health
  - fasting
  - optional-home-measurement
relations:

  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
measurementContexts:
  - fingerstick_bhb
  - clinician_directed_labs
unit: mmol/L
interpretationFrame:
  principle: Ketones may rise during fasting, but the goal is not to maximize ketones; symptoms, hydration, glucose context, and medication risk matter more.
  caveat: SGLT2 inhibitor use, diabetes, illness, dehydration, vomiting, or concerning symptoms require clinician guidance rather than self-interpretation.
biomarker:
  shortName: BHB
  displayName: Blood Ketones / Beta-Hydroxybutyrate
  unit: mmol/L
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Contextual.
    nuance: A higher ketone reading can simply mean a deeper fasted state, not a better health outcome.
  measurement:
    bestContext: Optional fingerstick or clinician-directed measurement when the user already has a reason to track ketones.
    howToMeasure:
      - Use the same meter and strips.
      - Pair readings with symptoms, glucose context, hydration status, and medication risk.
      - Do not chase higher ketones or extend a fast to increase the number.
    confounders:
      - fasting duration
      - carbohydrate intake before fast
      - exercise
      - illness
      - dehydration
      - SGLT2 inhibitor use
      - alcohol
---

Ketones are optional context for the metabolic time-course, not a target that justifies longer or riskier fasting.
