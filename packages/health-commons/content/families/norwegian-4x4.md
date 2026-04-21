---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:norwegian-4x4
slug: families/norwegian-4x4
title: Norwegian 4x4
summary: Aerobic high-intensity interval training built around four 4-minute hard intervals, kept separate from sprint intervals, low-volume 1 x 4 HIIT, athlete variants, and cardiac-rehabilitation disease-treatment protocols.
status: field-testing
quality: usable
aliases:
  - 4x4 interval training
  - 4 by 4 intervals
  - Norwegian intervals
  - CERG 4x4
categories:
  - cardiovascular
  - exercise
  - hiit
  - vo2max
familyKind: modality
canonicalModality: aerobic_4x4_intervals
relations:
  -
    type: related_protocol
    target: protocol_variant:norwegian-4x4/norwegian-4x4
  -
    type: cites
    target: source_artifact:norwegian-4x4-bibliography
  -
    type: cites
    target: source_artifact:pmid-17414804
  -
    type: cites
    target: source_artifact:ntnu-cerg-norwegian-4x4
  -
    type: cites
    target: source_artifact:pmid-30733142
  -
    type: cites
    target: source_artifact:pmid-22879367
  -
    type: cites
    target: source_artifact:pmid-30376749
researchCoverage:
  bibliographyKey: source_artifact:norwegian-4x4-bibliography
  corpusStats:
    refinedPass2Records: 42
    landingCorpusRecords: 20
    canonicalProtocolSupportRecords: 5
    safetyAndContraindicationRecords: 9
    mixedOrNullClinicalRecords: 3
    adjacentVariantRecords: 4
    earliestYear: 2007
    latestYear: 2024
    auditCutoff: 2026-04-20
---

Norwegian 4x4 is the user-facing family for aerobic high-intensity interval sessions built around four 4-minute hard efforts.

Murph keeps this family separate from sprint-interval training, low-volume 1 x 4 HIIT, athletic performance protocols, and cardiac-rehabilitation disease-treatment protocols because those variants differ in dose, risk, population, and interpretation.
