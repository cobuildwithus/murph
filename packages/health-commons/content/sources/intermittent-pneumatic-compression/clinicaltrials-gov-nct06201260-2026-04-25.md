---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06201260-2026-04-25
slug: sources/intermittent-pneumatic-compression/clinicaltrials-gov-nct06201260-2026-04-25
title: "Effects of Intermittent Pneumatic Compression on Exercise-Induced Muscle Damage"
summary: "Current, pending, registry, and preprint context source for the pneumatic compression pants research package. Role: context-only; directness: direct_protocol. Current/pending context only; do not count as completed efficacy evidence. Rights unclear; verify before adding downloadable artifacts."
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
    url: "https://clinicaltrials.gov/study/NCT06201260"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06201260"
source:
  kind: other
  title: "Effects of Intermittent Pneumatic Compression on Exercise-Induced Muscle Damage"
  url: "https://clinicaltrials.gov/study/NCT06201260"
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: "rct"
  populationLabel: "See source extraction; use role/directness metadata rather than assuming consumer-pants generalization."
  aggregateRole: context
evidenceBucket: "Current, pending, registry, and preprint context"
directness: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "medium"
pdfRightsStatus: "unknown"
---

This source is included for **Current, pending, registry, and preprint context**.

**Findings:** Completed; hasResults false. The registry describes 30-minute high-pressure lower-limb intermittent pneumatic compression protocol at about 200 mmHg after flywheel-induced exercise-induced muscle damage compared with 30-minute placebo microcurrent setup with an electrostimulation device positioned on quadriceps but turned off. Planned endpoints include maximal voluntary knee-extension contraction, countermovement jump, broad jump, 0-6 muscle soreness Likert scale. No effect estimates posted; ClinicalTrials.gov hasResults is false.

**Why it matters:** This is a direct lower-limb IPC recovery registry record with a clearly specified high-pressure 30-minute dose and wearable-friendly endpoints, but it cannot be used as efficacy evidence without results.

**Potential experiment signals:** muscle soreness, knee-extension strength, countermovement jump, broad jump, 24- and 48-hour recovery windows.

**Protocol takeaway:** Track as direct protocol registry context only; do not use the record to claim benefit or no benefit because no results are posted.

**Claim use:** `context-only`. Registry record only; no posted ClinicalTrials.gov results. Completed status does not equal extracted efficacy evidence. Male-only young student sample. High-pressure dose around 200 mmHg may not match consumer pneumatic-compression pants settings. Population mismatch: Young healthy active men only; high-pressure lower-limb IPC and laboratory EIMD may not generalize to mixed adult recovery, travel, swelling, or routine wellness use. Artifact rights status: unknown; use external registry links or manifest metadata only unless redistributable rights are confirmed.
