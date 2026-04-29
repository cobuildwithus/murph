---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:fasting-tolerance-symptom-log
slug: biomarkers/fasting-tolerance-symptom-log
title: Fasting Tolerance Symptom Log
summary: A safety-first symptom-log outcome for a 24–72 hour fast, focused on whether the fast was completed without severe symptoms rather than on proving a health benefit.
status: draft
quality: usable
aliases:
  - fasting symptoms
  - fasting tolerability
  - fast tolerance log
categories:
  - fasting
  - safety
  - symptom-log
  - manual-measurement
relations:

  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
measurementContexts:
  - during_fast_symptom_log
  - post_refeed_symptom_log
unit: symptom log
interpretationFrame:
  principle: Stable or mild symptoms are not proof of benefit, but severe or escalating symptoms are a safety signal and should override adherence goals.
  caveat: A symptom log does not clear diabetes, medication, eating-disorder, cardiovascular, kidney, pregnancy, or refeeding risk.
biomarker:
  shortName: Fasting tolerance
  displayName: Fasting Tolerance Symptom Log
  unit: symptom log
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower symptom burden is better.
    nuance: Any severe symptom should be treated as a stop signal, not as useful experiment stress.
  trendDefaults:
    latestWindowDays: 1
    comparisonWindowDays: 7
    minimumPoints: 1
    aggregation: median
  explainerCards:

    -
      title: What it is
      body: A structured log of hunger, headache, dizziness, faintness, palpitations, chest symptoms, confusion, mood, sleep disruption, hydration context, and refeed symptoms.
    -
      title: Why it matters
      body: For this protocol, safe completion and refeed tolerance matter more than stretching the fast to hit an arbitrary duration.
  measurement:
    bestContext: Log before the fast, during the fast, at the planned end, and after the first refeed.
    howToMeasure:
      - Use the same simple severity scale each time, such as none, mild, moderate, severe.
      - Record severe symptoms immediately and stop the fast according to the protocol stop rules.
      - Keep hydration, heat, exercise, illness, and medication changes visible as context.
    confounders:
      - illness
      - dehydration
      - heat exposure
      - strenuous exercise
      - caffeine withdrawal
      - sleep loss
      - medication change
      - high stress
---

This is the default primary Murph endpoint for a community 24–72 hour fasting experiment because safety and tolerability are more decision-relevant than a single acute biomarker change.
