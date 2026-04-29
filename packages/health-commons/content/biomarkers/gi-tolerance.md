---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:gi-tolerance
slug: biomarkers/gi-tolerance
title: GI Tolerance
summary: A daily symptom check for nausea, stomach upset, belching, diarrhea, or abdominal discomfort during creatine dosing.
status: draft
quality: usable
categories:
  - symptoms
  - tolerability
  - manual-checkin
relations:

  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
measurementContexts:
  - creatine_self_experiment
  - manual_checkin
unit: score
interpretationFrame:
  principle: Compare the same measure under similar conditions across baseline and intervention windows rather than reacting to one unusually good or bad day.
  caveat: Creatine experiments are easily confounded by training changes, diet changes, hydration shifts, illness, sleep disruption, and other supplements.
biomarker:
  shortName: GI Tolerance
  displayName: GI Tolerance
  unit: score
  valuePrecision: 1
  direction:
    desired: lower
    label: Lower symptom burden is usually better.
    nuance: Large single servings, loading, timing with meals, caffeine, protein blends, illness, and other supplements can all change symptoms.
  measurement:
    bestContext: Log symptoms near dosing and later the same day, especially during loading or dose changes.
    howToMeasure:
      - Use one consistent 0-to-10 GI symptom score or simple none/mild/moderate/severe scale.
      - Log dose size, number of servings, meal timing, and co-ingested products.
      - Separate creatine symptoms from illness, alcohol, high-fiber meals, caffeine, or new supplements.
    confounders:
      - large_single_serving
      - loading_phase
      - meal_timing_change
      - caffeine_or_preworkout
      - new_supplement
      - illness
      - alcohol
---

A daily symptom check for nausea, stomach upset, belching, diarrhea, or abdominal discomfort during creatine dosing.
