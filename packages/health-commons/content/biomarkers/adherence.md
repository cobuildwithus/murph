---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:adherence
slug: biomarkers/adherence
title: Adherence
summary: The percentage or count of planned creatine doses completed during the intervention window.
status: draft
quality: usable
categories:
  - adherence
  - manual-log
relations:

  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
measurementContexts:
  - creatine_self_experiment
  - manual_checkin
unit: percent
interpretationFrame:
  principle: Compare the same measure under similar conditions across baseline and intervention windows rather than reacting to one unusually good or bad day.
  caveat: Creatine experiments are easily confounded by training changes, diet changes, hydration shifts, illness, sleep disruption, and other supplements.
biomarker:
  shortName: Adherence
  displayName: Adherence
  unit: percent
  valuePrecision: 1
  direction:
    desired: higher
    label: Higher adherence makes the experiment easier to interpret.
    nuance: Missed doses, product changes, loading burden, and GI symptoms can all reduce interpretability.
  measurement:
    bestContext: Track planned versus completed doses and serving counts every day during the creatine window.
    howToMeasure:
      - Record whether the daily dose was taken.
      - Log the total grams and number of servings when loading or splitting doses.
      - Flag product changes, travel, refill gaps, and intentional pauses.
    confounders:
      - travel
      - refill_gap
      - loading_burden
      - gi_symptoms
      - routine_change
      - product_change
---

The percentage or count of planned creatine doses completed during the intervention window.
