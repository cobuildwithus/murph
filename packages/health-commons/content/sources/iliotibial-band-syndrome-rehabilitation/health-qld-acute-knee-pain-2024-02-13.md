---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:health-qld-acute-knee-pain-2024-02-13
slug: sources/iliotibial-band-syndrome-rehabilitation/health-qld-acute-knee-pain-2024-02-13
title: "Knee pain (acute)"
summary: "Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Orthopedic referral pathway with priority..."
status: draft
quality: usable
aliases:
  - "health-qld-acute-knee-pain-2024-02-13"
categories:
  - iliotibial-band-syndrome-rehabilitation
relations:
  -
    type: related_protocol
    target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
  -
    type: parent_family
    target: experiment_family:iliotibial-band-syndrome-rehabilitation
source:
  kind: guideline
  title: "Knee pain (acute)"
  citation: "Knee pain (acute)"
  url: "https://www.health.qld.gov.au/cpc/orthopaedics/acute-knee-pain"
researchEvidence:
  designKind: guideline
  designLabel: "guideline"
  populationLabel: "safety_boundary"
  durationLabel: "Not extracted in metadata pass"
  aggregateRole: primary
  cohortKey: "health-qld-acute-knee-pain-2024-02-13"
  notes:
    - "Metadata-pass extraction from the canonical source ledger; full-text effect details were not extracted in this pass."
evidenceBucket: "differential_diagnosis_and_safety_boundary"
whyItMatters: "Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Orthopedic referral pathway with priority criteria for locked knee, displaced meniscal tear, collateral ligament injury, and osteochondral fragments."
potentialMurphEndpoints:
  - lateral knee pain
  - running tolerance
  - return-to-run progression
protocolTakeaway: "Relevant mainly for context, safety, or variant boundaries."
murphTakeaway: "Use conservatively with the canonical directness and claim-use labels."
studyDesign: "guideline"
modality: "iliotibial band syndrome rehabilitation"
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **differential_diagnosis_and_safety_boundary**.

## Quick read

- **Source type:** guideline.
- **Directness:** `safety_boundary`.
- **Claim use:** `safety-only`.
- **Priority:** `medium`.

## Why it matters

Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Orthopedic referral pathway with priority criteria for locked knee, displaced meniscal tear, collateral ligament injury, and osteochondral fragments.

## Important limits

This page was generated from the canonical reducer ledger metadata pass. Do not cite unextracted sample sizes, effect sizes, or adverse-event rates from this page alone.
