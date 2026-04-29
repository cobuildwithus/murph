---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ncbi-sleep-physiology-rem
slug: sources/rem-sleep/ncbi-sleep-physiology-rem
title: Sleep Physiology and REM Sleep Architecture
summary: NCBI Bookshelf physiology chapter describing normal NREM/REM cycling, REM timing, REM physiology, and REM proportion of total sleep.
status: draft
quality: usable
categories:
  - rem-sleep
  - sleep-architecture
  - physiology
relations:

  -
    type: measures
    target: biomarker:rem-sleep-minutes
source:
  kind: book
  title: Sleep Physiology
  authors: Colten HR; Altevogt BM; Institute of Medicine Committee on Sleep Medicine and Research
  year: 2006
  citation: 'Institute of Medicine. Sleep Disorders and Sleep Deprivation: An Unmet Public Health Problem. Washington (DC): National Academies Press; 2006. Chapter: Sleep Physiology.'
  url: https://www.ncbi.nlm.nih.gov/books/NBK19956/
researchEvidence:
  designKind: narrative_review
  designLabel: Physiology reference chapter
  populationLabel: General adult sleep physiology
  aggregateRole: context
  aggregationNote: Background reference for sleep-stage physiology and normal architecture, not an intervention study.
evidenceBucket: Physiology context
whyItMatters: Explains why REM minutes are sensitive to sleep timing, sleep duration, and later-night sleep opportunity.
potentialMurphEndpoints:
  - REM sleep minutes
  - REM percentage
  - sleep-stage distribution
murphTakeaway: REM is normally later-night weighted and roughly one-fifth to one-quarter of total sleep in healthy adults, so early wake times and curtailed sleep can depress REM totals.
---

This physiology reference supports the page’s context-first interpretation. REM minutes are not just a nightly score; they reflect where a person is in the NREM/REM cycle, how much sleep opportunity they had, and whether the later part of the sleep period was preserved.
