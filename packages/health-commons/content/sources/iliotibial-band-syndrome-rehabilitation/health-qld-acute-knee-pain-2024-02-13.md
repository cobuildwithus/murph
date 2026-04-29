---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:health-qld-acute-knee-pain-2024-02-13
slug: sources/iliotibial-band-syndrome-rehabilitation/health-qld-acute-knee-pain-2024-02-13
title: Knee pain (acute)
summary: 'Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Orthopedic referral pathway with priority criteria for locked knee, displaced meniscal tear, collateral ligament injury, and osteochondral fragments.'
status: draft
quality: usable
aliases:
- health-qld-acute-knee-pain-2024-02-13
categories:
- iliotibial-band-syndrome-rehabilitation
- differential_diagnosis_and_safety_boundary
relations:
- type: related_protocol
  target: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
- type: parent_family
  target: experiment_family:iliotibial-band-syndrome-rehabilitation
source:
  kind: guideline
  title: Knee pain (acute)
  citation: Knee pain (acute)
  url: https://www.health.qld.gov.au/cpc/orthopaedics/acute-knee-pain
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: general guideline
  durationLabel: Not extracted in local fallback
  aggregateRole: synthesis
  cohortKey: health-qld-acute-knee-pain-2024-02-13
  notes:
  - Local fallback extraction from the canonical source ledger; full-text effect details were not extracted in this pass.
  - 'Reducer priority: medium; claim-use label: safety-only; directness label: safety_boundary.'
evidenceBucket: differential_diagnosis_and_safety_boundary
whyItMatters: 'Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Orthopedic referral pathway with priority criteria for locked knee, displaced meniscal tear, collateral ligament injury, and osteochondral fragments.'
potentialMurphEndpoints:
- lateral knee pain
- pain-free running duration
- graded return-to-run tolerance
- rehab adherence
- stop-condition events
protocolTakeaway: Use for safety boundaries, escalation routing, or differential-diagnosis framing rather than active-rehab efficacy.
murphTakeaway: Use conservatively with the canonical directness and claim-use labels; avoid unextracted sample sizes, effect sizes, adverse-event rates, or timelines.
studyDesign: guideline
modality: iliotibial band syndrome rehabilitation
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **differential diagnosis and safety boundaries**.

## Quick read

- **Source type:** guideline.
- **Directness:** `safety_boundary`.
- **Claim use:** `safety-only`.
- **Priority:** `medium`.
- **Rights posture:** `unknown` in the ledger; no PDF is committed from this source page.

## Why it matters

Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Orthopedic referral pathway with priority criteria for locked knee, displaced meniscal tear, collateral ligament injury, and osteochondral fragments.

## How Murph should use it

Use for safety boundaries, escalation routing, or differential-diagnosis framing rather than active-rehab efficacy.

## Important limits

This page was generated from the normalized local fallback source-page drafts and the canonical reducer ledger after the large extraction prompts did not return full source-extraction artifacts. It preserves source keys, directness, claim-use labels, priorities, and reducer notes, but it does **not** support adding sample sizes, effect sizes, adverse-event rates, or source-level results that are not otherwise extracted.

## Plain-language takeaway

Keep this source in its assigned evidence bucket and do not let it make the return-to-run protocol stronger than the extracted record supports.
