---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06628609-2026-04-25
slug: sources/intermittent-pneumatic-compression/clinicaltrials-gov-nct06628609-2026-04-25
title: "Effects of Different Therapeutic Modalities in the Recovery of Muscles After Physical Exercise in CrossFit"
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
    url: "https://clinicaltrials.gov/study/NCT06628609"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06628609"
source:
  kind: other
  title: "Effects of Different Therapeutic Modalities in the Recovery of Muscles After Physical Exercise in CrossFit"
  url: "https://clinicaltrials.gov/study/NCT06628609"
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

**Findings:** Completed; hasResults false. The registry describes 30 minutes of lower-limb pneumatic compression after a CrossFit WOD involving Assault AirBike calories, Hang Squat Clean, and Box Jump Over compared with Passive recovery for 30 minutes, photobiomodulation with static magnetic field, and shock-wave therapy in crossover sequence. Planned endpoints include countermovement jump, lactate dehydrogenase, TBARS, carbonylated proteins, catalase activity, superoxide dismutase activity, 0-100 rating of perceived exertion, satisfaction Likert scale. No effect estimates posted; ClinicalTrials.gov hasResults is false.

**Why it matters:** This registry record is directly relevant to post-exercise lower-limb IPC and popular recovery comparators, but it remains a methods/context source until results are posted or published.

**Potential experiment signals:** countermovement jump, muscle-damage markers, oxidative-stress markers, perceived exertion, satisfaction, 24- and 48-hour recovery windows.

**Protocol takeaway:** Use for dose, comparator, and endpoint planning only; do not claim IPC efficacy from this registry record.

**Claim use:** `context-only`. Registry record only; no posted ClinicalTrials.gov results. Very small actual enrollment of 12 participants. Crossover comparison includes several active modalities, which helps comparison but complicates simple protocol claims. Male-only CrossFit sample. Population mismatch: Male amateur CrossFit sample and acute WOD setting may not generalize to non-athletes, female users, older users, travel swelling, or clinical edema. Artifact rights status: unknown; use external registry links or manifest metadata only unless redistributable rights are confirmed.
