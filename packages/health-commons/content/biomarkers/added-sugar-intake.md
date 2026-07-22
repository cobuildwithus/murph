---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:added-sugar-intake
slug: biomarkers/added-sugar-intake
title: Added Sugar Intake
summary: Estimated daily added-sugar intake, usually logged from packaged-food Nutrition Facts labels plus obvious unlabeled added-sugar sources.
status: draft
quality: usable
aliases:
- daily added sugar
- added sugars grams
- added-sugar grams per day
categories:
- nutrition
- dietary intake
- added-sugar-reduction
unit: g/day
measurementContexts:
- home self-experiment
- dietary behavior tracking
interpretationFrame:
  principle: Lower or stable at a consciously chosen low level is generally the goal during an added-sugar-reduction experiment.
  caveat: Interpret the metric in context; single-day values can be distorted by logging gaps, travel, illness, menstrual cycle, hydration, restaurant meals, or other behavior changes.
biomarker:
  displayName: Added Sugar Intake
  unit: g/day
  valuePrecision: 0
  direction:
    desired: lower
    label: Lower or stable at a consciously chosen low level is generally the goal during an added-sugar-reduction experiment.
  measurement:
    bestContext: 'Use a consistent logging method across baseline and intervention: record grams of Added Sugars from packaged foods and separately note unlabeled sources such as sweetened drinks, desserts, syrups, honey, or restaurant foods.'
    howToMeasure:
    - Record baseline without changing behavior for at least 14 days.
    - During the intervention, log grams of Added Sugars per day from labels when available.
    - For unlabeled foods, log the item and whether it likely contained added sugar rather than inventing precise grams.
    - Keep added sugar separate from total sugar and from broader free-sugar definitions.
    confounders:
    - missing food logs
    - restaurant or unlabeled foods
    - free-sugar versus added-sugar definition choice
    - social events
    - replacement foods
---

Added Sugar Intake is included here because No Added Sugar needs a practical primary or secondary signal that can be tracked during a self-experiment.

## Measurement note

Use a consistent logging method across baseline and intervention: record grams of Added Sugars from packaged foods and separately note unlabeled sources such as sweetened drinks, desserts, syrups, honey, or restaurant foods.

## Interpretation

Lower or stable at a consciously chosen low level is generally the goal during an added-sugar-reduction experiment. Interpret the metric in context; single-day values can be distorted by logging gaps, travel, illness, menstrual cycle, hydration, restaurant meals, or other behavior changes.
