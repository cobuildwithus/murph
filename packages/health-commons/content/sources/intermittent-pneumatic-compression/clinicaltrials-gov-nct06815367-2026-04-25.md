---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06815367-2026-04-25
slug: sources/intermittent-pneumatic-compression/clinicaltrials-gov-nct06815367-2026-04-25
title: "Comparing the Effects of Pneumatic Compression and Blood Flow Restriction on Muscle Recovery"
summary: "Current, pending, registry, and preprint context source for the pneumatic compression pants research package. Role: context-only; directness: adjacent_variant. Current/pending context only; do not count as completed efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
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
    url: "https://clinicaltrials.gov/study/NCT06815367"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06815367"
source:
  kind: other
  title: "Comparing the Effects of Pneumatic Compression and Blood Flow Restriction on Muscle Recovery"
  url: "https://clinicaltrials.gov/study/NCT06815367"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "rct"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Current, pending, registry, and preprint context"
directness: "adjacent_variant"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Current, pending, registry, and preprint context**.

**Findings:** Recruiting; hasResults false. The registry describes 20 minutes of pneumatic compression at 100 mmHg after downhill treadmill running at -10% grade and 9 km/h for 20 minutes, with 5-minute warm-up/cool-down periods compared with Blood-flow restriction treatment and no-treatment control. Planned endpoints include countermovement jump height, maximal voluntary isometric contraction, sedentary delayed-onset muscle soreness by VAS, active delayed-onset muscle soreness during wall sit by VAS. No effect estimates posted; ClinicalTrials.gov hasResults is false and the trial status is recruiting.

**Why it matters:** This is useful boundary evidence because it directly compares IPC with BFR for DOMS and lists practical safety exclusions, but it is not a completed efficacy result.

**Potential experiment signals:** DOMS at rest and during wall sit, countermovement jump, MVIC, 24-hour post-treatment follow-up, contraindication screening.

**Protocol takeaway:** Use for comparator and safety-boundary mapping only; do not promote it into direct protocol claims.

**Claim use:** `context-only`. Recruiting registry record with estimated enrollment and no results. Parallel design may be more exposed to between-person variability than crossover recovery studies. BFR comparator and safety-screening context should not be treated as direct pants efficacy evidence. Young healthy recreational sample only. Population mismatch: Directly includes IPC but the canonical role is adjacent-variant because the trial is a BFR/IPC comparator and lacks pants-specific implementation details. Artifact rights status: unknown; use external registry links or manifest metadata only unless redistributable rights are confirmed.
