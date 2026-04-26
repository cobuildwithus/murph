---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:waist-circumference
slug: biomarkers/waist-circumference
title: Waist Circumference
summary: At-home waist circumference tracked as a secondary adiposity-context signal when a user can measure it consistently.
status: draft
quality: usable
aliases:
- waist measurement
- waist size
- waist circumference
categories:
- body_state
- body composition
- nutrition
unit: cm
measurementContexts:
- home self-experiment
- dietary behavior tracking
interpretationFrame:
  principle: Lower or stable may be useful context, but short experiments should not promise a waist change.
  caveat: Interpret the metric in context; single-day values can be distorted by logging gaps, travel, illness, menstrual cycle, hydration, restaurant meals, or other behavior changes.
biomarker:
  displayName: Waist Circumference
  unit: cm
  valuePrecision: 0
  direction:
    desired: lower_or_stable
    label: Lower or stable may be useful context, but short experiments should not promise a waist change.
  measurement:
    bestContext: Measure at the same anatomical point with the same tape tension, preferably in the morning, and interpret changes over weeks rather than days.
    howToMeasure:
    - Use a flexible tape measure.
    - Measure at a consistent anatomical landmark.
    - Take two readings and record the average if they are close.
    - Do not overinterpret tiny day-to-day changes.
    confounders:
    - measurement placement
    - tape tension
    - bloating
    - meal timing
    - hydration
    - menstrual cycle
---

Waist Circumference is included here because the No Added Sugar Diet needs a practical primary or secondary signal that can be tracked during a self-experiment.

## Measurement note

Measure at the same anatomical point with the same tape tension, preferably in the morning, and interpret changes over weeks rather than days.

## Interpretation

Lower or stable may be useful context, but short experiments should not promise a waist change. Interpret the metric in context; single-day values can be distorted by logging gaps, travel, illness, menstrual cycle, hydration, restaurant meals, or other behavior changes.
