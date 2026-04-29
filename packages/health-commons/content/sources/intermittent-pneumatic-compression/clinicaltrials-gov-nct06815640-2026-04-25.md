---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06815640-2026-04-25
slug: sources/intermittent-pneumatic-compression/clinicaltrials-gov-nct06815640-2026-04-25
title: "Effects of Intermittent Pneumatic Compression on the Recovery of High-level Cyclists"
summary: "Current, pending, registry, and preprint context source for the pneumatic compression pants research package. Role: context-only; directness: direct_protocol. Duplicate NCT06815640 registry rows normalized to one ClinicalTrials.gov snapshot key. Deduped from 3 candidate rows across direct-sports-recovery, performance-physiology-mechanisms, registries-preprints-current. Current/pending context only; do not count as completed efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
status: draft
quality: usable
categories:
  - intermittent-pneumatic-compression
relations:

  -
    type: related_protocol
    target: protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants
  -
    type: parent_family
    target: experiment_family:intermittent-pneumatic-compression
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: "https://clinicaltrials.gov/study/NCT06815640"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06815640"
source:
  kind: other
  title: "Effects of Intermittent Pneumatic Compression on the Recovery of High-level Cyclists"
  url: "https://clinicaltrials.gov/study/NCT06815640"
researchEvidence:
  designKind: crossover_trial
  designLabel: "crossover"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Current, pending, registry, and preprint context"
directness: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Current, pending, registry, and preprint context**.

**Findings:** Completed; hasResults false. The registry describes 30-minute intermittent pneumatic compression peristaltic protocol at 200 mmHg after a cycling fatigue protocol compared with Hydrant cream placebo. Planned endpoints include muscle soreness, creatine kinase, low-frequency fatigue / Myocene Powerdex score, 4-minute cycling time trial, isometric knee-extension strength, perceived fatigue, sleep diary, Total Quality Recovery, nutritional diaries. No effect estimates posted; ClinicalTrials.gov hasResults is false.

**Why it matters:** This is one of the closest pending/completed registry records for direct lower-limb IPC in sport recovery, with performance, biochemical, perceptual, and sleep-related endpoints.

**Potential experiment signals:** muscle soreness, creatine kinase, low-frequency fatigue, 4-minute time trial, isometric knee-extension strength, perceived fatigue, sleep diary, Total Quality Recovery.

**Protocol takeaway:** Track as direct registry context; do not use as outcome evidence until posted or published results are extracted separately.

**Claim use:** `context-only`. Registry record only; no posted ClinicalTrials.gov results. Completed status should not be counted as efficacy evidence. Male high-level cyclist sample and 200 mmHg dose may not generalize to consumer use. Placebo cream is not a device sham and may not preserve blinding to compression sensation. Population mismatch: High-level male cyclists and high-pressure laboratory recovery protocol may not generalize to casual users, female users, older adults, or non-exercise swelling contexts. Artifact rights status: unknown; use external registry links or manifest metadata only unless redistributable rights are confirmed.
