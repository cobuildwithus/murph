---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:morning-light-exposure
slug: families/morning-light-exposure
title: Morning Light Exposure
summary: Morning light exposure protocols use early-day light as a circadian cue, with the default Murph variant focused on outdoor ambient natural light soon after waking rather than devices, dawn simulators, or clinical light therapy.
status: field-testing
quality: usable
aliases:
  - morning daylight
  - morning sunlight
  - early-day light exposure
  - post-wake light exposure
  - morning bright light
categories:
  - sleep
  - circadian
  - light-exposure
  - outdoor-light
  - morning-routine
familyKind: modality
canonicalModality: morning_outdoor_ambient_light
relations:

  -
    type: related_protocol
    target: protocol_variant:morning-light-exposure/morning-outdoor-light-exposure
  -
    type: cites
    target: source_artifact:cdc-protect-yourself-from-extreme-heat-2024-06-25
  -
    type: cites
    target: source_artifact:doi-10.31086-tjgeri.2020.147
  -
    type: cites
    target: source_artifact:morning-light-exposure-bibliography
  -
    type: cites
    target: source_artifact:pmid-19560724
  -
    type: cites
    target: source_artifact:pmid-28786887
  -
    type: cites
    target: source_artifact:pmid-28891192
  -
    type: cites
    target: source_artifact:pmid-29348073
  -
    type: cites
    target: source_artifact:pmid-30670164
  -
    type: cites
    target: source_artifact:pmid-34488088
  -
    type: cites
    target: source_artifact:pmid-35298459
  -
    type: cites
    target: source_artifact:pmid-37812713
  -
    type: cites
    target: source_artifact:pmid-39077837
  -
    type: cites
    target: source_artifact:pmid-41053799
  -
    type: cites
    target: source_artifact:pmid-41426466
  -
    type: cites
    target: source_artifact:who-ultraviolet-radiation-2022-06-21
researchCoverage:
  bibliographyKey: source_artifact:morning-light-exposure-bibliography
  corpusStats:
    canonicalSourceRecords: 270
    sourcePageDrafts: 270
    sourceExtractionBatches: 10
    supportsProtocolRecords: 5
    contextOnlyRecords: 229
    safetyOnlyRecords: 40
    backboneRecords: 31
    directProtocolRecords: 10
    directOutdoorDaylightProtocolRecords: 19
    timingDoseCircadianMetricRecords: 34
    freeLivingObservationalMeasurementRecords: 22
    indoorWorkplaceClassroomHomeDaylightRecords: 20
    clinicalLightTherapyDeviceBoundaryRecords: 37
    safetyBoundaryRecords: 40
    auditCutoff: 2026-04-24
---

Morning Light Exposure is the family for early-day light protocols that use light timing as a circadian cue.

## What belongs in this family

The default Murph protocol belongs here when the behavior is simple and repeatable: go outdoors soon after waking, receive ambient natural daylight without sun-gazing, and log timing, duration, outdoor-versus-window status, weather/brightness context, symptoms, and sleep outcomes. The closest direct evidence is small and older-adult/institutional, while broader adult support is mostly observational.

## What stays separate

Keep light boxes, dawn simulators, indoor dynamic lighting, workplace/classroom/window-light protocols, SAD/depression light therapy, clinician-guided circadian treatment, travel/jet-lag countermeasures, and morning walk or exercise bundles separate unless a future page deliberately defines one of those variants. Those adjacent sources can inform mechanisms, measurement, and safety, but they should not be pooled into direct evidence for the default outdoor habit.

## How to read the evidence

The research corpus separates direct outdoor evidence, free-living observational context, dose and measurement guidance, adjacent variants, population modifiers, and safety boundaries. The practical claim is intentionally narrow: morning outdoor light is a plausible, low-burden self-experiment for subjective sleep quality, sleep timing, morning alertness, and tolerability, but it is not a proven treatment for insomnia, depression, bipolar disorder, seasonal affective disorder, or diagnosed circadian rhythm sleep-wake disorders.

## Safety posture

Safety is stronger than efficacy here. The family should preserve boundaries around mood activation/mania risk, eye disease or visual symptoms, migraine/photophobia, photosensitizing medications, sun allergy, UV exposure, heat, and unsafe outdoor routes.
