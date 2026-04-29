---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:sauna-fi-guidelines-bathing-2026-04-27"
slug: "sources/dry-sauna/sauna-fi-guidelines-bathing-2026-04-27"
title: "Guidelines for bathing in the sauna"
summary: "Finnish Sauna Society provides official practice instructions for sauna bathing."
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
  title: "Guidelines for bathing in the sauna"
  url: "https://sauna.fi/en/sauna-knowledge/guidelines-for-bathing-in-the-sauna"
  citation: "Guidelines for bathing in the sauna. https://sauna.fi/en/sauna-knowledge/guidelines-for-bathing-in-the-sauna"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "74a4cb09a0496ef3a4cc8acc263b3703487c97211eebd67eaa29f0754c363f5d"
    url: "https://sauna.fi/en/sauna-knowledge/guidelines-for-bathing-in-the-sauna"
  canonicalUrl: "https://sauna.fi/en/sauna-knowledge/guidelines-for-bathing-in-the-sauna"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "People newly moved to Finland and general sauna users"
  durationLabel: "Finnish sauna bathing"
  aggregateRole: "primary"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | not found in available source pages, artifact manifests, or referenced content keys | Primary Finnish sauna society implementation source for newcomer-safe sauna-use language; use for cultural/practical guidance, not efficacy claims."
  cohortKey: "sauna-fi-guidelines-bathing-2026-04-27"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:sauna-fi-guidelines-bathing-comic-instructions"
    sourceKey: "source_artifact:sauna-fi-guidelines-bathing-2026-04-27"
    extractedFromArtifactId: "art_sauna_fi_guidelines_bathing_web"
    findingKind: "context"
    population: "People newly moved to Finland and general sauna users"
    exposure: "Finnish sauna bathing"
    outcome: "Practical bathing instructions"
    summary: "The Finnish Sauna Society provides multilingual comic-strip instructions explaining what sauna is and how it should be used."
    evidenceUse:
      - "context"
  -
    findingId: "finding:sauna-fi-guidelines-rights-note"
    sourceKey: "source_artifact:sauna-fi-guidelines-bathing-2026-04-27"
    extractedFromArtifactId: "art_sauna_fi_guidelines_bathing_web"
    findingKind: "context"
    population: "Private users of the instructions"
    exposure: "Printed/distributed instructions"
    outcome: "Rights/redistribution boundary"
    summary: "The page states the instructions may be freely distributed and printed for private use when crediting the Finnish Sauna Society."
    evidenceUse:
      - "context"
---

This source is included for **safety contraindications**.

## Why it matters

Supports protocol-operational and etiquette language, not health-outcome claims.

## Findings captured

- The Finnish Sauna Society provides multilingual comic-strip instructions explaining what sauna is and how it should be used.
- The page states the instructions may be freely distributed and printed for private use when crediting the Finnish Sauna Society.

## Protocol takeaway

Finnish Sauna Society provides official practice instructions for sauna bathing.

## Important limits

The accessible page describes the instruction artifact but not all step details in plain text.
