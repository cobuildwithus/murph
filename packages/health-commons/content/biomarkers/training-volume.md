---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:training-volume
slug: biomarkers/training-volume
title: Training Volume
summary: A completed-work signal such as sets, reps, tonnage, intervals, or session completion used to contextualize performance changes during creatine use.
status: draft
quality: usable
categories:
  - exercise
  - training-log
  - manual-log
relations:

  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
measurementContexts:
  - creatine_self_experiment
  - manual_checkin
unit: work
interpretationFrame:
  principle: Compare the same measure under similar conditions across baseline and intervention windows rather than reacting to one unusually good or bad day.
  caveat: Creatine experiments are easily confounded by training changes, diet changes, hydration shifts, illness, sleep disruption, and other supplements.
biomarker:
  shortName: Training Volume
  displayName: Training Volume
  unit: work
  valuePrecision: 1
  direction:
    desired: higher_or_stable
    label: Stable or higher completed work can be favorable.
    nuance: More volume can be a training-plan change rather than a creatine effect, so log planned versus completed work.
  measurement:
    bestContext: Use planned versus completed sets, reps, load, tonnage, intervals, or session completion from a stable training block.
    howToMeasure:
      - Define the training-volume metric before the experiment starts.
      - Record planned and completed work, not just best sets.
      - Flag deloads, missed sessions, injuries, travel, and new programming.
    confounders:
      - program_change
      - deload
      - missed_sessions
      - injury
      - travel
      - calorie_change
      - motivation_change
---

A completed-work signal such as sets, reps, tonnage, intervals, or session completion used to contextualize performance changes during creatine use.
