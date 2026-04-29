---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:creatine-supplementation
slug: families/creatine-supplementation
title: Creatine Supplementation
summary: Creatine supplementation protocols, anchored by plain creatine monohydrate, separated from alternative formulations, blends, cognition-only claims, pediatric or pregnancy use, and clinician-supervised disease-treatment contexts.
status: draft
quality: usable
categories:
  - supplementation
  - sports-nutrition
  - strength
  - body-composition
  - high-intensity-performance
familyKind: intervention_family
canonicalModality: plain_creatine_monohydrate
canonicalMechanism: increase_creatine_phosphocreatine_availability
relations:

  -
    type: related_protocol
    target: protocol_variant:creatine-supplementation/creatine-monohydrate
  -
    type: cites
    target: source_artifact:doi-10.2903-j.efsa.2024.9100
  -
    type: cites
    target: source_artifact:ods-dietary-supplements-exercise-athletic-performance-2024-04-01
  -
    type: cites
    target: source_artifact:pmid-12485548
  -
    type: cites
    target: source_artifact:pmid-12945830
  -
    type: cites
    target: source_artifact:pmid-17908288
  -
    type: cites
    target: source_artifact:pmid-25946994
  -
    type: cites
    target: source_artifact:pmid-27328852
  -
    type: cites
    target: source_artifact:pmid-28615996
  -
    type: cites
    target: source_artifact:pmid-30935142
  -
    type: cites
    target: source_artifact:pmid-33557850
  -
    type: cites
    target: source_artifact:pmid-35986981
  -
    type: cites
    target: source_artifact:pmid-36041731
  -
    type: cites
    target: source_artifact:pmid-37221858
  -
    type: cites
    target: source_artifact:pmid-39042054
  -
    type: cites
    target: source_artifact:pmid-39074168
  -
    type: cites
    target: source_artifact:pmid-39519498
  -
    type: cites
    target: source_artifact:pmid-39861368
  -
    type: cites
    target: source_artifact:pmid-40944139
  -
    type: cites
    target: source_artifact:pmid-41328071
  -
    type: cites
    target: source_artifact:pmid-12660409
  -
    type: cites
    target: source_artifact:pmid-8828669
  -
    type: cites
    target: source_artifact:pmid-9390981
  -
    type: cites
    target: source_artifact:pmid-1327657
  -
    type: cites
    target: source_artifact:pmid-8944667
  -
    type: cites
    target: source_artifact:pmid-18373286
  -
    type: cites
    target: source_artifact:pmid-19295968
  -
    type: cites
    target: source_artifact:pmid-40198156
  -
    type: cites
    target: source_artifact:pmid-10999421
  -
    type: cites
    target: source_artifact:pmid-36000773
  -
    type: cites
    target: source_artifact:pmid-29138605
  -
    type: cites
    target: source_artifact:pmid-37432300
  -
    type: cites
    target: source_artifact:pmid-41062952
  -
    type: cites
    target: source_artifact:pmid-41388441
  -
    type: cites
    target: source_artifact:pmid-41433021
  -
    type: cites
    target: source_artifact:pmid-29704637
  -
    type: cites
    target: source_artifact:pmid-38582412
  -
    type: cites
    target: source_artifact:pmid-39070254
researchCoverage:
  protocolKey: protocol_variant:creatine-supplementation/creatine-monohydrate
  canonicalLedgerRecords: 303
  normalizedSourcePageDrafts: 298
  nonSourcePageContextRows: 5
  sourceExtractionBatches: 11
  maxRecordsPerExtractionBatch: 38
  priorityCounts:
    backbone: 37
    medium: 121
    high: 137
    low: 3
    exclude: 5
  evidenceBucketCounts:
    background_guidelines_external: 20
    strength_hypertrophy_synthesis: 17
    synthesis_background: 2
    repeated_sprint_power_synthesis: 4
    strength_hypertrophy_trials: 10
    repeated_sprint_power_trials: 38
    dose_loading_maintenance: 33
    timing_coingestion: 22
    safety_tolerability_adverse_events: 22
    body_weight_water_gi: 11
    renal_safety_labs: 36
    formulation_variant_boundary: 33
    population_boundary_adjacent_claims: 51
    trial_registry_excluded: 4
  directnessCounts:
    background: 29
    same_mechanism: 19
    direct_protocol: 129
    adjacent_variant: 64
    safety_boundary: 59
    clinical_supervised: 3
  claimUseCounts:
    context-only: 107
    supports-protocol: 137
    safety-only: 54
    do-not-use: 5
  batchCounts:
    batch-001: 26
    batch-002: 10
    batch-003: 38
    batch-004: 33
    batch-005: 22
    batch-006: 33
    batch-007: 36
    batch-008: 32
    batch-009: 37
    batch-010: 17
    batch-012: 14
  notes:
    - This narrowed page-builder draft does not regenerate source pages.
    - The final landing reducer should apply source pages from the normalized extraction draft artifacts.
    - No source-extraction run processed more than 40 source records.
    - Copyrighted PDFs are not included in Git or in the package zip.
---

Creatine supplementation is the umbrella family for protocols that intentionally change creatine intake. In this package, the canonical Murph variant is **plain creatine monohydrate**.

## Family boundary

The family includes daily monohydrate dosing, optional loading, maintenance dosing, and measurement of training-performance, body-weight, lean-mass proxy, tolerance, and safety context. The strongest default protocol boundary is healthy-adult resistance-training or repeated high-intensity work.

## What stays separate

Creatine HCl, ethyl ester, buffered creatine, nitrate, chelates, citrate/pyruvate, liquid serums, and multi-ingredient products should be separate variants unless their evidence can cleanly bridge to monohydrate with creatine-equivalent dosing and no co-ingredient attribution problem.

Cognition-only, bone-health, pregnancy/perinatal, pediatric, psychiatric, renal-disease, muscle-disorder, Parkinson disease, and other clinical disease-treatment uses are boundary or context evidence, not default healthy-adult self-experiment claims.

## Evidence posture

The family has a large research corpus, but the actionable landing page should be conservative: source pages preserve supportive, null, mixed, safety-only, and population-mismatch findings. The clearest default use is a monitored monohydrate experiment, not a universal supplement claim.

## Research-run notes

The canonical source ledger contains 303 records. The normalized source-page draft authority contains 298 source pages across 11 extraction batches, with no extraction batch above 38 records. The five non-source-page ledger rows are context/excluded records and should not be turned into source pages without a separate review.
