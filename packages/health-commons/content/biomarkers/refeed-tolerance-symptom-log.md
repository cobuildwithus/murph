---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:refeed-tolerance-symptom-log
slug: biomarkers/refeed-tolerance-symptom-log
title: Refeed Tolerance Symptom Log
summary: A post-fast safety symptom log focused on the first refeed window and severe symptoms that require stopping self-experimentation or seeking care.
status: draft
quality: usable
aliases:
  - refeeding symptoms
  - post-fast symptoms
  - refeed tolerance
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
  - post_refeed_symptom_log
unit: symptom log
interpretationFrame:
  principle: The key read is whether refeeding was tolerated without severe neurologic, cardiovascular, respiratory, swelling, or weakness symptoms.
  caveat: High-risk refeeding is clinical care; a home symptom log is not a substitute for electrolyte, thiamine, or medical management when risk factors are present.
biomarker:
  shortName: Refeed symptoms
  displayName: Refeed Tolerance Symptom Log
  unit: symptom log
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower symptom burden is better.
    nuance: Severe symptoms after refeeding are a safety signal, not an experiment result to optimize.
  measurement:
    bestContext: Log the first refeed time, what was eaten, and symptoms over the first hours after refeeding.
    howToMeasure:
      - Record first refeed time and symptoms.
      - Watch for severe weakness, confusion, ataxia, swelling, breathlessness, chest symptoms, palpitations, or other severe symptoms.
      - Route high-risk refeeding features to clinician guidance.
    confounders:
      - fast length
      - recent poor intake
      - low body weight
      - recent weight loss
      - electrolyte risk
      - alcohol
      - illness
      - eating-disorder risk
---

Refeed tolerance is a safety outcome for a fasting run, especially for longer selected durations or users with any nutritional-risk history.
