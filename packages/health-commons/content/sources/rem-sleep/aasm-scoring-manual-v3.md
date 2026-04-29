---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:aasm-scoring-manual-v3
slug: sources/rem-sleep/aasm-scoring-manual-v3
title: AASM Manual for the Scoring of Sleep and Associated Events, Version 3
summary: Official AASM scoring reference for polysomnography and home sleep apnea test rules, including sleep-stage scoring.
status: draft
quality: usable
categories:
  - rem-sleep
  - sleep-scoring
  - clinical-reference
relations:

  -
    type: measures
    target: biomarker:rem-sleep-minutes
source:
  kind: guideline
  title: 'AASM Manual for the Scoring of Sleep and Associated Events: Rules, Terminology and Technical Specifications, Version 3'
  authors: American Academy of Sleep Medicine
  year: 2023
  citation: 'American Academy of Sleep Medicine. AASM Manual for the Scoring of Sleep and Associated Events: Rules, Terminology and Technical Specifications, Version 3.'
  url: https://shop.aasm.org/products/aasm-scoring-manual-3-bundle-1
researchEvidence:
  designKind: guideline
  designLabel: Sleep-stage scoring reference
  populationLabel: Polysomnography and home sleep apnea test interpretation
  aggregateRole: context
  aggregationNote: Standard reference for scoring rules rather than an intervention or validation cohort.
evidenceBucket: Clinical scoring standard
whyItMatters: Establishes laboratory sleep-stage scoring as the reference frame for interpreting REM sleep.
potentialMurphEndpoints:
  - REM sleep minutes
  - REM sleep percentage
  - PSG sleep stage scoring
murphTakeaway: Use PSG-scored REM as the meaning anchor; consumer wearable REM should be treated as an estimate layered on top of that reference standard.
---

This source anchors REM sleep to formal sleep-stage scoring. For Murph, the important product implication is that REM minutes have a clinical meaning when scored under sleep-lab rules, while wearable REM minutes are an inferred approximation of that lab-defined state.
