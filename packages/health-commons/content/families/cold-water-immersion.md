---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:cold-water-immersion
slug: families/cold-water-immersion
title: Cold Water Immersion
summary: Deliberate cold-water immersion in a tub, plunge tank, or bath-like setup, kept separate from winter swimming, cold showers, cryotherapy, contrast therapy, and breathwork stacks.
status: field-testing
quality: usable
aliases:
  - cold water immersion
  - CWI
  - ice bath
  - cold tub
  - cold bath
categories:
  - cold-exposure
  - recovery
  - stress
familyKind: intervention
canonicalModality: controlled_cold_water_immersion
relations:
  -
    type: related_protocol
    target: protocol_variant:cold-water-immersion/cold-plunge
  -
    type: cites
    target: source_artifact:cold-water-immersion-bibliography
  -
    type: cites
    target: source_artifact:pmid-39879231
  -
    type: cites
    target: source_artifact:pmid-37866096
  -
    type: cites
    target: source_artifact:pmid-36829490
  -
    type: cites
    target: source_artifact:pmid-37711459
  -
    type: cites
    target: source_artifact:pmid-38211547
  -
    type: cites
    target: source_artifact:pmid-2691172
  -
    type: cites
    target: source_artifact:pmid-35157264
  -
    type: cites
    target: source_artifact:pmid-33146851
  -
    type: cites
    target: source_artifact:hubermanlab-cold-exposure-2022-05-01
researchCoverage:
  bibliographyKey: source_artifact:cold-water-immersion-bibliography
  corpusStats:
    totalRecords: 55
    directProtocolRecords: 13
    adjacentVariantRecords: 30
    safetyBoundaryRecords: 8
    sameMechanismRecords: 2
    clinicalSupervisedRecords: 1
    backgroundRecords: 1
    supportsProtocolRecords: 6
    contextOnlyRecords: 36
    safetyOnlyRecords: 12
    doNotUseRecords: 1
    reviewRecords: 20
    journalArticleRecords: 34
    webPageRecords: 1
    earliestYear: 1989
    latestYear: 2025
    auditCutoff: 2026-04-22
  variantBuckets:
    - controlled tub or plunge immersion
    - post-exercise CWI
    - winter swimming or open water
    - cold shower
    - whole-body cryotherapy
    - contrast water therapy
    - external named protocols and public dose heuristics
---

Cold Water Immersion is the broad family for deliberate immersion in cold water when the exposure is intentional, bounded, and doseable.

## What belongs here

This family covers controlled immersion in a tub, bath, plunge tank, or closely similar setup where a person can approximate water temperature, session length, and exit conditions.

## What stays separate

This family should not collapse together:

- stand-alone cold plunge,
- post-exercise CWI,
- winter swimming or open-water immersion,
- cold showers,
- whole-body cryotherapy,
- contrast water therapy,
- or breathwork-plus-cold stacks.

Those buckets answer different questions, involve different safety profiles, and often use different endpoints. The strongest adjacent recovery studies are athlete and post-exercise papers, while the strongest safety literature is about entry-phase cold shock and cardiac or drowning risk rather than durable wellbeing gains.

## How to read this family

The current corpus is good enough to support one cautious Murph protocol, **Cold Plunge**, but not broad family-level promises. Direct healthy-adult plunge evidence is still a narrow subset inside a much larger cold-exposure literature. The family page therefore acts as the boundary-setting layer: useful for navigation, search, and future branching, not for flattening every cold modality into one recipe.
