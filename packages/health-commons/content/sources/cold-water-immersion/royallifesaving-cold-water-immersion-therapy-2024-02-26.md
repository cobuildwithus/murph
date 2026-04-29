---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:royallifesaving-cold-water-immersion-therapy-2024-02-26
slug: sources/cold-water-immersion/royallifesaving-cold-water-immersion-therapy-2024-02-26
title: Position Statement on Cold Water Immersion Therapy Safety Precautions in Aquatic, Fitness and Leisure Settings
summary: Position statement on safety precautions for cold-water immersion therapy settings.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: guideline
  title: Position Statement on Cold Water Immersion Therapy Safety Precautions in Aquatic, Fitness and Leisure Settings
  authors: Royal Life Saving Society - Australia; AUSactive; SPASA
  year: 2024
  journal: Royal Life Saving Society - Australia
  url: https://www.royallifesaving.com.au/research-and-policy/policy/position-statements/cold-water-immersion-therapy
  citation: Royal Life Saving Society - Australia; AUSactive; SPASA. Position Statement on Cold Water Immersion Therapy Safety Precautions in Aquatic, Fitness and Leisure Settings. Royal Life Saving Society - Australia. 2024. https://www.royallifesaving.com.au/research-and-policy/policy/position-statements/cold-water-immersion-therapy
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 2c3cf2a4ca57511241d8723509ba76e6888576c8fafc6c76878425bebf9a5c8c
    url: https://www.royallifesaving.com.au/research-and-policy/policy/position-statements/cold-water-immersion-therapy
  canonicalUrl: https://www.royallifesaving.com.au/research-and-policy/policy/position-statements/cold-water-immersion-therapy
  identityAliases:
  - Royal Life Saving Society - Australia 2024
  - Position Statement on Cold Water Immersion Therapy Safety Precautions in Aquatic, Fitness and Leisure Settings
researchEvidence:
  designKind: guideline
  designLabel: Position statement on cold-water immersion therapy safety precautions
  populationLabel: People using cold-water immersion therapy in aquatic, fitness, and leisure settings
  durationLabel: Safety position statement; implementation guidance
  cohortKey: cohort:royallifesaving-cold-water-immersion-therapy-2024-02-26
  aggregateRole: synthesis
  notes:
  - Generated source-index.json was absent from the supplied snapshot; resolved against canonical ledger and local candidate records only.
  - 'Canonical ledger note: Candidate shards: 11-discovery-registries-current-trials; raw candidate rows merged: 1. Candidate IDs: candidate:registries-current-trials:035. Generated source-index.json was absent from supplied snapshot; no existing cold-water source inventory was available, so this is a provisional new-source resolution pending generated-index check. Safety-only: use for screens, stop rules, contraindications, or adverse-event context, not benefit claims.'
  - 'Cold Plunge extraction context: bucket=Safety, adverse events, and cold-shock boundaries; directness=general_guideline; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:royallifesaving-cold-water-immersion-therapy-2024-02-26:position-statement-safety-precautions
  sourceKey: source_artifact:royallifesaving-cold-water-immersion-therapy-2024-02-26
  extractedFromArtifactId: art_royallifesaving_cold_water_immersion_therapy_2024_02_26
  findingKind: safety
  population: People using cold-water immersion therapy in aquatic, fitness, and leisure settings
  exposure: Cold-water immersion therapy safety policies, screening, temperature control, and supervision
  outcome: temperature monitoring; screening; supervision; emergency planning; risk reduction
  summary: This position statement for aquatic, fitness, and leisure settings recommends cold-water immersion therapy safety precautions such as screening, temperature monitoring/control, supervision, acclimatization, and emergency planning. It treats colder-than-typical water as requiring additional risk reduction.
  evidenceUse:
  - safety
  - context
coldPlungeExtraction:
  batchId: batch-005
  evidenceBucket: Safety, adverse events, and cold-shock boundaries
  directness: general_guideline
  claimUse: safety-only
  priority: high
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- Royal Life Saving Society - Australia 2024
- Position Statement on Cold Water Immersion Therapy Safety Precautions in Aquatic, Fitness and Leisure Settings
---

This source is included for **Safety, adverse events, and cold-shock boundaries**.

**Findings:** This position statement for aquatic, fitness, and leisure settings recommends cold-water immersion therapy safety precautions such as screening, temperature monitoring/control, supervision, acclimatization, and emergency planning. It treats colder-than-typical water as requiring additional risk reduction.

**Why it matters:** Most directly relevant external safety protocol source in the batch for consumer/service cold-water immersion therapy.

**Potential experiment signals:** water temperature, session duration, supervision, medical screening, emergency equipment/plan.

**Protocol takeaway:** Use as direct safety guidance for screening, temperature ranges, supervision, acclimatization, and emergency planning.

**Claim use:** `safety-only`.

## Extraction notes

- Directness to Cold Plunge: `general_guideline`.
- Population mismatch: Facility safety guidance may not fully cover unsupervised home use, but is directly applicable to protocol guardrails.
- Limitations: Position statement/guideline, not a trial.; Settings include aquatic, fitness, and leisure facilities; individual medical risk still varies.
- Artifact rights: `open_access`. No copyrighted PDF is included in Git; this draft records metadata and candidate artifact information only.
