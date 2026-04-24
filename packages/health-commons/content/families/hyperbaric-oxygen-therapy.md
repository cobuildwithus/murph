---
schemaVersion: "murph.commons.page.v1"
entityType: "experiment_family"
key: "experiment_family:hyperbaric-oxygen-therapy"
slug: "families/hyperbaric-oxygen-therapy"
title: "Hyperbaric Oxygen Therapy"
summary: "The clinical systemic HBOT family, separated from mild/soft chambers, topical oxygen, normobaric oxygen, EWOT, and broad wellness claims."
status: "draft"
quality: "usable"
aliases:
  - "HBOT"
  - "hyperbaric oxygen"
  - "clinical HBOT"
  - "oxygen therapy family"
categories:
  - "oxygen-therapy"
  - "clinical-supervised"
  - "safety-sensitive"
familyKind: "intervention"
canonicalModality: "supervised_systemic_chamber_hbot"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy"
  -
    type: "cites"
    target: "source_artifact:pmid-38092370"
  -
    type: "cites"
    target: "source_artifact:uhms-hbo-indications-2020-01-01"
  -
    type: "cites"
    target: "source_artifact:cms-ncd-20-29-hyperbaric-oxygen-2017-11-17"
  -
    type: "cites"
    target: "source_artifact:pmid-15881548"
  -
    type: "cites"
    target: "source_artifact:fda-hbot-get-the-facts-2021-07-26"
  -
    type: "cites"
    target: "source_artifact:eubs-mild-hyperbaric-therapies-2022-12-20"
  -
    type: "cites"
    target: "source_artifact:doi-10-22462-07-08-2018-15"
  -
    type: "cites"
    target: "source_artifact:doi-10-22462-05-06-2018-15"
  -
    type: "cites"
    target: "source_artifact:pmid-37275378"
  -
    type: "cites"
    target: "source_artifact:pmid-32491593"
researchCoverage:
  corpusStats:
    canonicalLedgerRecords: 321
    sourcePagesDrafted: 321
    sectionClaimsSynthesized: 80
    artifactCandidatesRaw: 306
    auditRun: "hyperbaric-oxygen-therapy-20260423-093246Z"
  variantBuckets:
    - "clinical systemic chamber HBOT"
    - "mild or soft-chamber hyperbaric exposure"
    - "topical oxygen and topical hyperbaric oxygen devices"
    - "normobaric oxygen and EWOT"
    - "healthy-aging and wellness claims"
    - "acute hospital-only indications"
    - "late radiation injury"
    - "problem wounds and diabetic-foot ulcers"
    - "ENT and sudden sensorineural hearing loss"
---

# Hyperbaric Oxygen Therapy

This family page is the boundary layer for oxygen therapies that are often conflated in public language. The canonical Murph protocol is **supervised systemic chamber HBOT**.

Safety boundary: this family page is not a self-treatment guide. Do not use Murph to start HBOT for current carbon-monoxide exposure/poisoning, decompression illness, gas embolism, crush or traumatic ischemia, non-healing wounds, radiation injury, sudden hearing loss, or neurologic symptoms/diagnoses. Acute indications require emergency or hospital pathways. Chronic wound, radiation, ENT, and neurologic uses require a treating clinician/facility plan and should be handled as separate clinical variants with indication-specific outcomes, not as ordinary wellness experiments.

Mild chambers, soft/fabric chambers, topical oxygen, topical hyperbaric oxygen, normobaric oxygen, exercise-with-oxygen therapy, athlete oxygen exposure, and commercial wellness or rejuvenation programs should stay as adjacent variants unless their own evidence pages are built.

The family evidence map is intentionally safety-sensitive. Some clinical lanes have substantial source coverage, such as selected diabetic-foot ulcers, late radiation injury, sudden sensorineural hearing loss, and acute hospital-only indications. Other lanes, especially healthy-aging, cognition optimization, aesthetic, performance, and longevity claims, remain off-label or research-context claims rather than established Murph outcomes.
