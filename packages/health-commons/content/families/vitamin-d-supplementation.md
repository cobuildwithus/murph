---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:vitamin-d-supplementation
slug: families/vitamin-d-supplementation
title: Vitamin D Supplementation
summary: Protocol family for experiments that change vitamin D status through supplementation, kept separate by compound, route, dosing schedule, dose intensity, and clinical-supervision requirements.
status: draft
quality: usable
aliases:
  - vitamin D supplements
  - cholecalciferol supplementation
  - vitamin D3 supplementation
  - 25(OH)D lab feedback
categories:
  - supplements
  - nutrition
  - biomarker-feedback
  - vitamin-d
relations:

  -
    type: related_protocol
    target: protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation
  -
    type: primary_biomarker
    target: biomarker:serum-25-hydroxyvitamin-d
lineage:
  relationship: root
  rationale: Built from the vitamin-d-supplementation research ledger and section syntheses.
attribution:
  ownerType: murph
  note: Murph Health Commons
researchCoverage:
  canonicalLedgerRecords: 207
  sourcePagesDrafted: 204
  invalidCandidatesSkipped: 3
  auditCutoff: 2026-04-25
---

Vitamin D Supplementation is the parent family for protocols that use supplemental vitamin D to change vitamin D status. This family keeps oral daily cholecalciferol, ergocalciferol, calcifediol, active vitamin D analogues, intermittent bolus dosing, fortified-food interventions, UVB/sunlight protocols, and clinician-managed disease protocols separate.

## Canonical child protocol

- **Daily Vitamin D3 Supplementation** (`protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation`) is the current Murph canonical variant for a general adult, daily oral cholecalciferol experiment with serum 25(OH)D as the primary measurable endpoint. Its direct evidence base is strongest for changing 25(OH)D, not for broad disease-prevention claims.

## What belongs in separate variants

- Vitamin D2, calcifediol, calcitriol or active analogues, large bolus schedules, UVB exposure, fortified-food trials, pregnancy or pediatric protocols, CKD-MBD care, osteoporosis drug co-therapy, and clinically supervised correction should be kept out of this canonical daily D3 variant unless a dedicated page is created.

## Evidence posture

The cleanest self-experiment endpoint is serum or plasma 25(OH)D. Bone, falls, respiratory, mood, fatigue, cardiovascular, kidney-stone, and mortality outcomes are mixed, long-horizon, population-specific, or safety-context evidence and should not be promoted as guaranteed benefits.
