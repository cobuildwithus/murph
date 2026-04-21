---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:estimated-vo2max
slug: biomarkers/estimated-vo2max
title: Estimated VO2max
summary: A consumer-device cardio-fitness estimate used as a practical proxy for cardiorespiratory fitness in bounded Murph experiments.
status: field-testing
quality: usable
aliases:
  - wearable VO2max
  - cardio fitness estimate
  - estimated cardio fitness
categories:
  - cardiovascular
  - fitness
  - wearable-metric
relations:
  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: cites
    target: source_artifact:pmid-17414804
  -
    type: cites
    target: source_artifact:pmid-30733142
  -
    type: cites
    target: source_artifact:pmid-24066036
measurementContexts:
  - wearable_cardio_fitness
  - field_test_proxy
unit: ml/kg/min estimate
interpretationFrame:
  principle: Trend direction and repeated signal are more useful than a single absolute value.
  caveat: Consumer estimates are not laboratory gas-exchange VO2max measurements and may update slowly or noisily.
---

Estimated VO2max is Murph's practical primary endpoint for Norwegian 4x4 because the intervention literature targets cardiorespiratory fitness, but most users have consumer wearable estimates rather than lab testing.

Interpret this marker as a noisy proxy. A useful result should combine this estimate with session fidelity, heart-rate recovery, symptoms, and adherence.
