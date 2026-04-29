---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07387276-2026-04-25
slug: sources/intermittent-pneumatic-compression/clinicaltrials-gov-nct07387276-2026-04-25
title: "Effects of Recovery Techniques on Pain, Force and Muscle Oxygenation in Athletes"
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
    url: "https://clinicaltrials.gov/study/NCT07387276"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT07387276"
source:
  kind: other
  title: "Effects of Recovery Techniques on Pain, Force and Muscle Oxygenation in Athletes"
  url: "https://clinicaltrials.gov/study/NCT07387276"
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

**Findings:** Not yet recruiting; hasResults false. The registry describes 20 minutes of pressotherapy using Hermes Professional, with a sequential six-chamber inflation cycle at 70-80 mmHg after high-intensity effort compared with TECAR therapy, percussive massage gun, extracorporeal shockwave therapy, manual sports massage, and intermittent negative pressure/cupping in crossover sequence. Planned endpoints include muscle oxygen saturation by NIRS, pressure pain threshold by algometry, maximum isometric calf strength by dynamometry, muscle surface temperature by thermography, participant satisfaction and perceived recovery. No effect estimates posted; ClinicalTrials.gov hasResults is false and status is not yet recruiting.

**Why it matters:** This current registry record maps an acute pressotherapy dose and objective muscle oxygenation/pain/force endpoints, but it is pending and cannot be used as outcome evidence.

**Potential experiment signals:** NIRS muscle oxygen saturation, pressure pain threshold, isometric strength, surface temperature, satisfaction/perceived recovery, one-week washout design.

**Protocol takeaway:** Use for pending-trial tracking and endpoint selection; do not claim benefit or superiority over other recovery modalities.

**Claim use:** `context-only`. Not-yet-recruiting registry record with estimated enrollment and no results. Six-modality comparator design helps context but does not yet provide any ranked efficacy result. Detailed description and status dates are not fully aligned, so timing should be treated cautiously. Male athlete population and acute gastrocnemius-focused endpoints are narrow. Population mismatch: Male competitive athletes, calf-focused immediate post-effort measurements, and clinic-based pressotherapy may not generalize to non-athletes, female users, travel swelling, or home wellness use. Artifact rights status: unknown; use external registry links or manifest metadata only unless redistributable rights are confirmed.
