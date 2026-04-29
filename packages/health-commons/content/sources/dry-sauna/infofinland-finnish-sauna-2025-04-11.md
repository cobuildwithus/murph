---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:infofinland-finnish-sauna-2025-04-11"
slug: "sources/dry-sauna/infofinland-finnish-sauna-2025-04-11"
title: "Finnish sauna"
summary: "InfoFinland gives practical Finnish-sauna parameters and basic safety rules."
status: "draft"
quality: "usable"
categories:
  - "dry-sauna"
  - "safety_contraindications"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
source:
  kind: "guideline"
  title: "Finnish sauna"
  url: "https://infofinland.fi/leisure/finnish-sauna"
  citation: "Finnish sauna. https://infofinland.fi/leisure/finnish-sauna"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "634aeab4f021af2c7ccb6407b633296df5c8b755256999c064f6efab890b8c61"
    url: "https://infofinland.fi/leisure/finnish-sauna"
  canonicalUrl: "https://infofinland.fi/leisure/finnish-sauna"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "General public and visitors to Finland"
  durationLabel: "Finnish sauna"
  aggregateRole: "primary"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | not found in available source pages, artifact manifests, or referenced content keys | Government-facing public guidance gives conservative implementation and safety language around 70-90 C Finnish sauna use."
  cohortKey: "infofinland-finnish-sauna-2025-04-11"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:infofinland-finnish-sauna-practice-70-90c"
    sourceKey: "source_artifact:infofinland-finnish-sauna-2025-04-11"
    extractedFromArtifactId: "art_infofinland_finnish_sauna_web"
    findingKind: "context"
    population: "General public and visitors to Finland"
    exposure: "Finnish sauna"
    outcome: "Temperature and bathing practice"
    summary: "InfoFinland describes Finnish sauna as usually 70–90°C and recommends drinking before sauna, showering before, sitting on a bench towel, adding small amounts of water to the stove, taking breaks, cooling off, and drinking water."
    evidenceUse:
      - "context"
      - "safety"
  -
    findingId: "finding:infofinland-sauna-stop-rules"
    sourceKey: "source_artifact:infofinland-finnish-sauna-2025-04-11"
    extractedFromArtifactId: "art_infofinland_finnish_sauna_web"
    findingKind: "safety"
    population: "General sauna users, including children"
    exposure: "Finnish sauna bathing"
    outcome: "Safety stop rules"
    summary: "InfoFinland advises starting carefully, monitoring how one feels, leaving if weak or unwell, supervising children around the stove, and avoiding sauna when feverish or ill."
    evidenceUse:
      - "safety"
---

This source is included for **safety contraindications**.

## Why it matters

Supports protocol implementation details such as 70–90°C, water, breaks, showering, and exit-if-unwell language.

## Findings captured

- InfoFinland describes Finnish sauna as usually 70–90°C and recommends drinking before sauna, showering before, sitting on a bench towel, adding small amounts of water to the stove, taking breaks, cooling off, and drinking water.
- InfoFinland advises starting carefully, monitoring how one feels, leaving if weak or unwell, supervising children around the stove, and avoiding sauna when feverish or ill.

## Protocol takeaway

InfoFinland gives practical Finnish-sauna parameters and basic safety rules.

## Important limits

Cultural/practical guidance only; no efficacy evidence.
