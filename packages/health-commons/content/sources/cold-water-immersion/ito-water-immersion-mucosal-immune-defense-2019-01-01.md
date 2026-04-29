---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ito-water-immersion-mucosal-immune-defense-2019-01-01
slug: sources/cold-water-immersion/ito-water-immersion-mucosal-immune-defense-2019-01-01
title: Effects of water immersion on mucosal immune defense after acute resistance exercise
summary: Metadata-only adjacent mucosal-immunity source; retained for recall but not used for cold-plunge efficacy.
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
  kind: journal_article
  title: Effects of water immersion on mucosal immune defense after acute resistance exercise
  authors: Ito H; Eda N; Hideya N; Norihide Y; Takao A
  year: 2019
  journal: Advances in Exercise and Sports Physiology
  url: https://www.jstage.jst.go.jp/browse/aesp/25/1/_contents/-char/en
  citation: Ito H; Eda N; Hideya N; Norihide Y; Takao A. Effects of water immersion on mucosal immune defense after acute resistance exercise. Advances in Exercise and Sports Physiology. 2019.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    titleHash: d6ea42a77766eb6edd328fe3ad4dd14b2bee287ae0ff0ad2794df15ccd155a14
    url: https://www.jstage.jst.go.jp/browse/aesp/25/1/_contents/-char/en
  canonicalUrl: https://www.jstage.jst.go.jp/browse/aesp/25/1/_contents/-char/en
  identityAliases:
  - Effects of water immersion on mucosal immune defense after acute resistance exercise
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Adjacent acute resistance-exercise water-immersion physiology study
  populationLabel: Resistance-exercise participants; exact sample not verified in accessible metadata
  durationLabel: Not confirmed in accessible metadata
  cohortKey: cohort:ito-water-immersion-mucosal-immune-defense-2019-01-01
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Water immersion after acute resistance exercise'
  - 'Comparator/control: Not confirmed in accessible metadata'
  - 'Endpoints: mucosal immune defense; immune markers; resistance-exercise recovery'
  - 'Effect direction: Accessible metadata indicates mucosal immune-defense outcomes after water immersion, but temperature, sample size, and effect direction were not verified.'
  - 'Safety/adverse-event notes: No adverse-event information was extracted.'
  - 'Limitations: Metadata-only extraction from candidate ledger/J-STAGE contents page.; Temperature and comparator not verified.; Not enough accessible detail to support any protocol claim.'
  - 'Population/directness caveat: Resistance-exercise immune context rather than resting cold plunging.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Sports recovery and training-adaptation boundary; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:ito-water-immersion-mucosal-immune-defense-2019-01-01:mucosal-immune-context
  sourceKey: source_artifact:ito-water-immersion-mucosal-immune-defense-2019-01-01
  extractedFromArtifactId: art_ito_water_immersion_mucosal_immune_defense_2019_01_01
  findingKind: context
  population: Resistance-exercise participants
  exposure: Water immersion after acute resistance exercise
  outcome: Mucosal immune defense
  summary: Accessible metadata identifies this as a water-immersion study of mucosal immune defense after acute resistance exercise; effect direction and dose were not verified.
  evidenceUse:
  - context
  - measurement
- findingId: finding:ito-water-immersion-mucosal-immune-defense-2019-01-01:metadata-uncertainty
  sourceKey: source_artifact:ito-water-immersion-mucosal-immune-defense-2019-01-01
  extractedFromArtifactId: art_ito_water_immersion_mucosal_immune_defense_2019_01_01
  findingKind: context
  population: Not reported in accessible extract
  exposure: J-STAGE source metadata
  outcome: Extraction certainty
  summary: Because temperature, sample size, comparator, and results were not extracted, this source should remain context-only.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-009
  evidenceBucket: Sports recovery and training-adaptation boundary
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: unknown
  identityResolutionStatus: new_source
aliases:
- Effects of water immersion on mucosal immune defense after acute resistance exercise
---

This source is included for **Sports recovery and training-adaptation boundary**.

**Findings:** Accessible metadata identifies this as a water-immersion study of mucosal immune defense after acute resistance exercise; effect direction and dose were not verified.; Because temperature, sample size, comparator, and results were not extracted, this source should remain context-only.

**Why it matters:** It prevents accidental omission of adjacent immune literature while preserving uncertainty.

**Potential experiment signals:** mucosal immune defense; immune markers; resistance-exercise recovery.

**Protocol takeaway:** Do not use for protocol claims unless full metadata and results are verified.

**Claim use:** `context-only`.

**Population mismatch:** Resistance-exercise immune context rather than resting cold plunging.

**Limitations:** Metadata-only extraction from candidate ledger/J-STAGE contents page.; Temperature and comparator not verified.; Not enough accessible detail to support any protocol claim.

**Artifact and rights note:** PDF rights status is `unknown`. This extraction creates a source-page draft and metadata/artifact candidate only; no copyrighted PDF is included in Git.
