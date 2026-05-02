---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: "source_artifact:doi-10.17241-smr.2020.00668"
slug: "sources/pre-sleep-downshift-practices/doi-10.17241-smr.2020.00668"
title: "The Effect of Deep Breathing Cycles with Various Ratios on Heart Rate Variability and the Sleep Quality of Healthy Young Adults"
summary: "The non-forced deep-breathing-cycle group improved wearable/app-derived sleep quality from 74.0±3.9% to 81.5±3.1% (p<0.001), increased total sleep time from 316.8±28.5 to 364.0±32.2 minutes (p<0.001), increased time in..."
status: draft
quality: usable
categories:
  - pre-sleep-downshift-practices
relations:

  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-resonance-breathing-and-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: "journal_article"
  title: "The Effect of Deep Breathing Cycles with Various Ratios on Heart Rate Variability and the Sleep Quality of Healthy Young Adults"
  authors: Jirawat Wattanapanyawech, Premtip Thaveeratitham
  journal: Sleep Medicine Research
  doi: "10.17241/smr.2020.00668"
  url: "https://www.sleepmedres.org/journal/view.php?number=148"
researchEvidence:
  designKind: other
  designLabel: "rct"
  aggregateRole: context
  cohortKey: "doi-10.17241-smr.2020.00668"
evidenceBucket: "Direct pre-sleep slow/resonance-breathing evidence"
protocolTakeaway: "Directly bedtime-timed breathing study, but the 'deep/forced' breathing framing may be outside the gentle resonance-breathing core. Candidate rows merged: 1; candidateIds: candidate:direct-presleep-slow-breathing:005; s..."
studyDesign: "rct"
claimUse: "supports-protocol"
sourceFindings:

  -
    findingId: "finding:doi-10.17241-smr.2020.00668-nfdbc-sleep-improvement"
    sourceKey: "source_artifact:doi-10.17241-smr.2020.00668"
    findingKind: intervention_result
    population: "Healthy Thai young adults aged 18–24; completed non-forced deep-breathing-cycle group n=10."
    exposure: "Non-forced deep breathing cycles performed at least 30 minutes before bedtime, consisting of repeated one-minute breathing-rhythm blocks with breath holds."
    outcome: "Wearable/app-derived sleep quality, time in bed, total sleep time, sleep onset latency, percent awake, and heart rate."
    summary: "The non-forced deep-breathing-cycle group improved wearable/app-derived sleep quality from 74.0±3.9% to 81.5±3.1% (p<0.001), increased total sleep time from 316.8±28.5 to 364.0±32.2 minutes (p<0.001), increased time in bed, decreased sleep onset latency by about 10 minutes, decreased percent awake, and lowered multiple heart-rate measures."
    evidenceUse:
      - efficacy
      - adjacent_variant
      - measurement
  -
    findingId: "finding:doi-10.17241-smr.2020.00668-forced-variant-boundary"
    sourceKey: "source_artifact:doi-10.17241-smr.2020.00668"
    findingKind: intervention_result
    population: "Healthy Thai young adults aged 18–24; forced deep-breathing-cycle arm."
    exposure: "Forced deep breathing cycles before bedtime, using fast and forceful breaths with breath holds."
    outcome: "Sleep onset latency, percent awake, and pre-sleep heart rate."
    summary: "The forced deep-breathing-cycle arm decreased percent awake but increased sleep onset latency by about 5.1 minutes (p<0.05) and increased heart rate before sleep, suggesting forced breathing is a poor fit for a gentle bedtime downshift protocol."
    evidenceUse:
      - efficacy
      - safety
      - adjacent_variant
  -
    findingId: "finding:doi-10.17241-smr.2020.00668-measurement-limit"
    sourceKey: "source_artifact:doi-10.17241-smr.2020.00668"
    findingKind: measurement_validation
    population: "Healthy young adults in the breathing-cycle study."
    exposure: "Apple Watch Series 5 and Pillow smartphone application sleep and heart-rate measurement."
    outcome: "Validity of sleep-stage, sleep-quality, and heart-rate endpoints."
    summary: "Sleep and heart-rate endpoints were measured with Apple Watch Series 5 and the Pillow application rather than polysomnography; the authors state that PSG is the gold standard and should be used in future work."
    evidenceUse:
      - measurement
      - context
  -
    findingId: "finding:doi-10.17241-smr.2020.00668-tolerability-note"
    sourceKey: "source_artifact:doi-10.17241-smr.2020.00668"
    findingKind: safety
    population: "Randomized forced deep-breathing-cycle participants."
    exposure: "Forced deep breathing cycles."
    outcome: "Ability to perform the breathing procedure and adverse-event extraction."
    summary: "One participant in the forced deep-breathing-cycle group withdrew because they could not perform the procedure; no formal adverse-event table was extracted from the article."
    evidenceUse:
      - safety
---

The non-forced deep-breathing-cycle group improved wearable/app-derived sleep quality from 74.0±3.9% to 81.5±3.1% (p<0.001), increased total sleep time from 316.8±28.5 to 364.0±32.2 minutes (p<0.001), increased time in...

**Finding 1:** The non-forced deep-breathing-cycle group improved wearable/app-derived sleep quality from 74.0±3.9% to 81.5±3.1% (p<0.001), increased total sleep time from 316.8±28.5 to 364.0±32.2 minutes (p<0.001), increased time in bed, decreased sleep onset latency by about 10 minutes, decreased percent awake, and lowered multiple heart-rate measures.

**Finding 2:** The forced deep-breathing-cycle arm decreased percent awake but increased sleep onset latency by about 5.1 minutes (p<0.05) and increased heart rate before sleep, suggesting forced breathing is a poor fit for a gentle bedtime downshift protocol.

**Finding 3:** Sleep and heart-rate endpoints were measured with Apple Watch Series 5 and the Pillow application rather than polysomnography; the authors state that PSG is the gold standard and should be used in future work.

**Murph use:** Directly bedtime-timed breathing study, but the 'deep/forced' breathing framing may be outside the gentle resonance-breathing core. Candidate rows merged: 1; candidateIds: candidate:direct-presleep-slow-breathing:005; shards: 02-discovery-direct-presleep-slow-breathing.
