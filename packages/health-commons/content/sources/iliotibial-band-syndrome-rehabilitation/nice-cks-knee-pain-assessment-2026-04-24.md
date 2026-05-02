---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-cks-knee-pain-assessment-2026-04-24
slug: sources/iliotibial-band-syndrome-rehabilitation/nice-cks-knee-pain-assessment-2026-04-24
title: Knee pain - assessment
summary: 'Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Authoritative primary-care guidance for urgent referral and assessment boundaries, adjacent to ITBS but highly relevant to safety language.'
status: draft
quality: usable
aliases:
- nice-cks-knee-pain-assessment-2026-04-24
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
  title: Knee pain - assessment
  authors: "National Institute for Health and Care Excellence"
  journal: "NICE Clinical Knowledge Summaries"
  citation: Knee pain - assessment
  url: https://cks.nice.org.uk/topics/knee-pain-assessment/
researchEvidence:
  designKind: guideline
  designLabel: guideline
  populationLabel: general guideline
  durationLabel: Not extracted in local fallback
  aggregateRole: synthesis
  cohortKey: nice-cks-knee-pain-assessment-2026-04-24
  notes:
  - Local fallback extraction from the canonical source ledger; full-text effect details were not extracted in this pass.
  - 'Reducer priority: medium; claim-use label: safety-only; directness label: safety_boundary.'
evidenceBucket: differential_diagnosis_and_safety_boundary
whyItMatters: 'Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Authoritative primary-care guidance for urgent referral and assessment boundaries, adjacent to ITBS but highly relevant to safety language.'
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

Merged 1 candidate row(s) from shard(s): differential-diagnosis-safety. Use for differential diagnosis, escalation, imaging, or red-flag routing rather than protocol efficacy. Authoritative primary-care guidance for urgent referral and assessment boundaries, adjacent to ITBS but highly relevant to safety language.

## How Murph should use it

Use for safety boundaries, escalation routing, or differential-diagnosis framing rather than active-rehab efficacy.

## Important limits

This page was generated from the normalized local fallback source-page drafts and the canonical reducer ledger after the large extraction prompts did not return full source-extraction artifacts. It preserves source keys, directness, claim-use labels, priorities, and reducer notes, but it does **not** support adding sample sizes, effect sizes, adverse-event rates, or source-level results that are not otherwise extracted.

## Plain-language takeaway

Keep this source in its assigned evidence bucket and do not let it make the return-to-run protocol stronger than the extracted record supports.
