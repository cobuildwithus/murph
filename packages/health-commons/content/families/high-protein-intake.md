---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:high-protein-intake
slug: families/high-protein-intake
title: High-Protein Intake
summary: Nutrition protocols that deliberately raise total daily dietary protein above baseline, kept separate from ketogenic diets, supplement-only protocols, protein pacing, athlete cutting, and clinical renal nutrition.
status: field-testing
quality: usable
aliases:
- high-protein diet
- higher-protein diet
- daily protein target
- protein-forward diet
categories:
- nutrition
- diet
- protein
- body-composition
- satiety
familyKind: intervention
canonicalModality: dietary_protein_intake_target
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
-
  type: cites
  target: source_artifact:high-protein-intake-bibliography
researchCoverage:
  bibliographyKey: source_artifact:high-protein-intake-bibliography
  corpusStats:
    canonicalLedgerRecords: 335
    sourcePagesNeeded: 334
    sourcePagesSkipped: 1
    sourceFindings: 526
    evidenceAppraisals: 334
    directProtocolLedgerRecords: 11
    supportsProtocolLedgerRecords: 9
    safetyOnlyLedgerRecords: 77
---

High-Protein Intake is the family for experiments that deliberately raise total daily dietary protein above a user’s baseline.

## What belongs in this family

Use this family when the intervention is a total daily protein target, usually expressed as grams per kilogram per day or grams per day, and the user can log achieved intake.

## What stays separate

Keep ketogenic or low-carbohydrate named diets, protein-supplement-only protocols, amino-acid or leucine-only protocols, protein pacing, athlete cutting, resistance-training cointerventions, pregnancy nutrition, renal clinical nutrition, gout treatment, kidney-stone treatment, and disease-specific diet therapy in adjacent or safety-boundary pages unless a future variant explicitly scopes them.

## How to read the evidence

The family evidence should stay stratified: direct target-dose trials, energy-balance and satiety context, training-adjacent evidence, meal-distribution evidence, source-delivery evidence, population strata, metabolic labs, kidney/gout/stone/pregnancy/liver safety boundaries, and implementation burden. The Protein Floor protocol carries the source-keyed claims and appraisal edges for the current canonical variant.
