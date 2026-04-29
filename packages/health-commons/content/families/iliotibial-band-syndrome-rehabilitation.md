---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:iliotibial-band-syndrome-rehabilitation
slug: families/iliotibial-band-syndrome-rehabilitation
title: Iliotibial Band Syndrome Rehabilitation
summary: Conservative rehabilitation protocols for ITBS, kept separate from urgent knee pain, cycling-specific bike-fit variants, passive-only care, injections, and surgery.
status: draft
quality: usable
aliases:
- IT band syndrome rehabilitation
- ITBS rehabilitation
- iliotibial band friction syndrome rehabilitation
- ITB friction syndrome rehab
- lateral knee pain runner rehab
categories:
- rehab
- running
- injury-rehab
- lateral-knee-pain
- load-management
familyKind: condition_rehabilitation
canonicalModality: symptom_guided_active_rehab
relations:
- type: related_protocol
  target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
- type: cites
  target: source_artifact:pmid-20145781
- type: cites
  target: source_artifact:pmid-22994651
- type: cites
  target: source_artifact:pmid-24226623
- type: cites
  target: source_artifact:pmid-24790783
- type: cites
  target: source_artifact:pmid-32448384
- type: cites
  target: source_artifact:pmid-34375405
- type: cites
  target: source_artifact:pmid-37300970
- type: cites
  target: source_artifact:pmid-39247485
- type: cites
  target: source_artifact:pmid-39593548
- type: cites
  target: source_artifact:pmid-14530229
- type: cites
  target: source_artifact:pmid-14734335
- type: cites
  target: source_artifact:pmid-19147613
- type: cites
  target: source_artifact:pmid-22134205
- type: cites
  target: source_artifact:pmid-23015995
- type: cites
  target: source_artifact:pmid-23821708
- type: cites
  target: source_artifact:pmid-30325638
- type: cites
  target: source_artifact:pmid-31194342
- type: cites
  target: source_artifact:pmid-32222797
- type: cites
  target: source_artifact:pmid-32370956
- type: cites
  target: source_artifact:massgeneral-itbs-rehab-protocol-2021-11-01
- type: cites
  target: source_artifact:massgeneral-return-to-running-program-2026-04-24
- type: cites
  target: source_artifact:osu-basic-return-to-running-guideline-2019-10-01
- type: cites
  target: source_artifact:brighamandwomens-itbs-standard-of-care-2007-01-01
- type: cites
  target: source_artifact:pmid-2028354
- type: cites
  target: source_artifact:pmid-15155424
- type: cites
  target: source_artifact:pmid-20836867
- type: cites
  target: source_artifact:pmid-32875305
- type: cites
  target: source_artifact:pmid-40015722
- type: cites
  target: source_artifact:doi-10.1016-s0031-9406-10-61197-2
- type: cites
  target: source_artifact:doi-10.1080-15438629509512030
- type: cites
  target: source_artifact:pmid-26406193
- type: cites
  target: source_artifact:pmid-34123517
- type: cites
  target: source_artifact:pmid-35855103
- type: cites
  target: source_artifact:pmid-41167567
- type: cites
  target: source_artifact:pmid-39219463
researchCoverage:
  corpusStats:
    canonicalLedgerRecords: 213
    materializedSourcePages: 208
    reducerDesignatedSourcePages: 190
    directRunnerRehabRecords: 28
    differentialSafetyRecords: 36
    passiveProcedureBoundaryRecords: 27
    runningMechanismContextRecords: 39
    cyclingAdjacentRecords: 30
    externalProtocolRecords: 10
    clinicalTrialRegistryRecords: 16
    auditCutoff: '2026-04-24'
  sourcePageCaveat: Normalized source pages are conservative local fallback artifacts generated from the canonical source ledger; full-text effect details were not extracted in the fallback pass.
---

Iliotibial Band Syndrome Rehabilitation is the family for conservative, active rehab plans that reduce provoking load, rebuild capacity, and return to sport with symptom-guided progression.

## What belongs in this family

Use this family for nontraumatic lateral-knee-pain protocols that are diagnosed as, or clearly consistent with, iliotibial band syndrome / iliotibial band friction syndrome. Core components include load modification, tolerable hip/glute and movement-control work, optional movement retraining, and graded return to running or sport.

## What stays separate

Keep acute traumatic knee injury, locked or swollen knee, inability to bear weight, fever or hot/red/warm joint, neurologic symptoms, focal bony pain, rest/night pain, suspected stress fracture, meniscal, ligament, cartilage, or patellofemoral mimic, adolescent knee/hip pain, post-surgical knees, pregnancy/postpartum return-to-run, persistent or refractory symptoms, medication-centered care, injection-centered care, shockwave or dry-needling modalities, clinician-directed manual/passive soft-tissue care, and surgery-centered care outside the ordinary self-guided family.

Cycling-specific ITBS and bike-fit evidence is adjacent. It can inform a future return-to-cycling variant, but it should not be merged into the runner return-to-run protocol.

## How to read the evidence

The family is deliberately evidence-bucketed. Direct runner rehab records are the backbone, recent reviews help scope the field, biomechanics and hip-strength sources provide mechanism and risk context, external protocols help implementation, passive/procedural sources define adjacent or escalation pathways, and safety/differential sources define boundaries. The local fallback source pages preserve reducer labels and caveats, but they do not add unextracted sample sizes, effect sizes, adverse-event rates, or precise return timelines.

## Current Murph protocol

The starter protocol in this family is **Iliotibial Band Syndrome Rehab And Return To Run**, a conservative, symptom-guided experiment for appropriate runners. It uses patient-trackable outcomes rather than lab biomarkers: lateral knee pain, pain-free run/walk duration, weekly running exposure, adherence, and stop-condition events.
