---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.3390-app151910762"
slug: "sources/dry-sauna/doi-10.3390-app151910762"
title: "Effect of a Four-Week Extreme Heat (100 ± 2 °C) Sauna Baths Program in Combination with Resistance Training on Lower Limb Strength and Body Composition: A Blinded, Randomized Study"
summary: "Extreme-heat sauna plus resistance training is a co-intervention boundary source."
status: "draft"
quality: "usable"
aliases:
  - "DOI 10.3390/app151910762"
categories:
  - "dry-sauna"
  - "modality_disambiguation"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
source:
  kind: "journal_article"
  title: "Effect of a Four-Week Extreme Heat (100 ± 2 °C) Sauna Baths Program in Combination with Resistance Training on Lower Limb Strength and Body Composition: A Blinded, Randomized Study"
  doi: "10.3390/app151910762"
  url: "https://doi.org/10.3390/app151910762"
  citation: "Effect of a Four-Week Extreme Heat (100 ± 2 °C) Sauna Baths Program in Combination with Resistance Training on Lower Limb Strength and Body Composition: A Blinded, Randomized Study. https://doi.org/10.3390/app151910762"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.3390/app151910762"
    titleHash: "077c9146bc6c039117f5a254a505b6510d0ed49cd209cd0f94246278d7dee649"
    url: "https://doi.org/10.3390/app151910762"
  canonicalUrl: "https://doi.org/10.3390/app151910762"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Rct"
  populationLabel: "Young male participants assigned to lower-limb resistance training with or without an extreme-heat sauna component."
  durationLabel: "Four weeks of resistance training plus two weekly extreme-heat sauna sessions at 100 ± 2 °C and about 24% relative humidity, four 10-minute sets per session; comparator was resistance training without sauna."
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from direct-intervention | source key already appears in available sauna artifact manifest | Recent randomized high-temperature sauna-plus-training study; adjacent because sauna is combined with resistance training."
  cohortKey: "doi-10.3390-app151910762"
evidenceBucket: "modality_disambiguation"
directnessToProtocol: "adjacent_variant"
claimUse: "context-only"
murphV1Priority: "medium"
artifactRightsStatusGuess: "open_access"
sourceFindings:

  -
    findingId: "finding:doi-10.3390-app151910762-extreme-heat-resistance-training"
    sourceKey: "source_artifact:doi-10.3390-app151910762"
    extractedFromArtifactId: "art_doi_10.3390_app151910762_pdf"
    findingKind: "intervention_result"
    population: "Young male participants assigned to lower-limb resistance training with or without an extreme-heat sauna component."
    exposure: "Four weeks of resistance training plus two weekly extreme-heat sauna sessions at 100 ± 2 °C and about 24% relative humidity, four 10-minute sets per session; comparator was resistance training without sauna."
    outcome: "Lower-limb strength, body composition, anthropometry, and four-week deconditioning outcomes."
    summary: "The abstract reports a 30-participant young-male randomized study with sauna layered onto resistance training. Because the sauna was hotter, less frequent than Murph, and inseparable from resistance training, its outcome signals should be treated as co-intervention and modality context rather than direct dry-sauna efficacy evidence."
    evidenceUse:
      - "adjacent_variant"
      - "context"
---

This source is included for **modality disambiguation**.

## Why it matters

Helps prevent training-plus-sauna outcomes from being promoted into stand-alone Finnish dry-sauna claims.

## Findings captured

- The abstract reports a 30-participant young-male randomized study with sauna layered onto resistance training. Because the sauna was hotter, less frequent than Murph, and inseparable from resistance training, its outcome signals should be treated as co-intervention and modality context rather than direct dry-sauna efficacy evidence.

## Protocol takeaway

Extreme-heat sauna plus resistance training is a co-intervention boundary source.

## Important limits

Sauna was 100 °C, twice weekly, and combined with resistance training, so sauna-only effects are not isolated.
