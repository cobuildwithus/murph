---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:time-restricted-eating
slug: families/time-restricted-eating
title: Time-Restricted Eating
summary: Daily eating-window protocols that restrict when calories are consumed while separating 18:6, 16:8, early, late, clinical, calorie-restricted, and longer-fasting variants.
status: field-testing
quality: usable
aliases:
- TRE
- time restricted eating
- time-restricted feeding
- TRF
- eating-window restriction
categories:
- nutrition
- metabolic-health
- circadian
- weight-management
relations:
- type: related_protocol
  target: protocol_variant:time-restricted-eating/time-restricted-eating-18-6
  note: Default Murph starter variant currently landed for this family.
- type: primary_biomarker
  target: biomarker:body-weight
- type: secondary_biomarker
  target: biomarker:waist-circumference
- type: secondary_biomarker
  target: biomarker:blood-glucose
- type: secondary_biomarker
  target: biomarker:morning-blood-pressure
- type: secondary_biomarker
  target: biomarker:sleep-efficiency
  note: Tracked as a safety and quality signal, not as an expected efficacy endpoint.
lineage:
  relationship: root
  rationale: Root family for eating-window protocols; protocol variants should remain separated by window length, clock timing, calorie restriction, and clinical population.
attribution:
  ownerType: murph
  note: Family page landed with the time-restricted-eating-18-6 final reducer using extracted research-seam source records.
---
# Time-Restricted Eating

Time-restricted eating protocols limit the daily window in which calories are consumed. This family keeps 18:6, 16:8, 8-hour early TRE, 10-hour metabolic-syndrome TRE, alternate-day fasting, multi-day fasting, calorie-restricted TRE, diabetes protocols, and other clinical variants separate so context sources are not converted into direct proof for a different protocol.

The current Murph landing variant is **18:6 Time-Restricted Eating With Graded Starter Windows**. Its exact ramp and minimum analyzable exposure are Murph implementation scaffolds, not evidence-derived optimal doses.
