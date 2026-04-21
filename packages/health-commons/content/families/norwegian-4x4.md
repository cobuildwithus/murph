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
    target: source_artifact:pmid-15179103
  -
    type: cites
    target: source_artifact:pmid-17548726
  -
    type: cites
    target: source_artifact:pmid-18606913
  -
    type: cites
    target: source_artifact:pmid-18673303
  -
    type: cites
    target: source_artifact:pmid-19958872
  -
    type: cites
    target: source_artifact:pmid-21450580
  -
    type: cites
    target: source_artifact:pmid-26440134
  -
    type: cites
    target: source_artifact:pmid-28385556
  -
    type: cites
    target: source_artifact:pmid-29502328
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
    refinedPass2Records: 51
    landingCorpusRecords: 29
    canonicalProtocolSupportRecords: 6
    clinicalLineageRecords: 6
    clinicalSynthesisRecords: 2
    safetyAndContraindicationRecords: 9
    mixedOrNullClinicalRecords: 3
    adjacentVariantRecords: 4
    earliestYear: 2004
    latestYear: 2024
    auditCutoff: 2026-04-21
---

Norwegian 4x4 is the family for aerobic high-intensity interval sessions built around four 4-minute hard efforts.

The source graph now includes the healthy-adult protocol backbone, direct 4HIIT-vs-1HIIT variant evidence, early supervised cardiometabolic and cardiac-rehabilitation lineage trials, later mixed/null clinical trials, and safety guidance. This family stays separate from sprint-interval training, low-volume 1 x 4 HIIT, adolescent or disease-treatment protocols, athletic performance protocols, hypertension treatment, and cardiac-rehabilitation protocols because those variants differ in dose, risk, population, supervision, and interpretation.
