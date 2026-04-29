---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:saunasociety-build-sauna-temperature-2026-04-27"
slug: "sources/dry-sauna/saunasociety-build-sauna-temperature-2026-04-27"
title: "Build a Sauna"
summary: "North American Sauna Society build guidance gives temperature and construction safety guardrails."
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
  kind: "web_page"
  title: "Build a Sauna"
  url: "https://saunasociety.org/build-a-sauna"
  citation: "Build a Sauna. https://saunasociety.org/build-a-sauna"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "d506421486419708fb0f59d47ce317dc7c2e7ce4facaedfc954e0bad8ef829c6"
    url: "https://saunasociety.org/build-a-sauna"
  canonicalUrl: "https://saunasociety.org/build-a-sauna"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "Home sauna builders/users in the United States"
  durationLabel: "Traditional sauna construction and operation"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | not found in available source pages, artifact manifests, or referenced content keys | Provides North American temperature-limit and ventilation context that may conflict with 100 C public-protocol language."
  cohortKey: "saunasociety-build-sauna-temperature-2026-04-27"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "general_guideline"
claimUse: "safety-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:saunasociety-build-temperature-195f-limit"
    sourceKey: "source_artifact:saunasociety-build-sauna-temperature-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_build_sauna_web"
    findingKind: "safety"
    population: "Home sauna builders/users in the United States"
    exposure: "Traditional sauna construction and operation"
    outcome: "Maximum temperature safety guidance"
    summary: "The North American Sauna Society page states UL 875 requires maximum sauna temperature in the US not to exceed 195°F and advises not exceeding that temperature regardless of heater type."
    evidenceUse:
      - "safety"
      - "context"
  -
    findingId: "finding:saunasociety-build-ventilation-and-layout"
    sourceKey: "source_artifact:saunasociety-build-sauna-temperature-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_build_sauna_web"
    findingKind: "safety"
    population: "Home sauna builders/users"
    exposure: "Sauna construction"
    outcome: "Ventilation, electrical safety, access to shower/cooling"
    summary: "The page emphasizes UL-listed heaters, licensed electrical work, adequate ventilation, nearby shower/cooling access, and basic layout requirements."
    evidenceUse:
      - "safety"
      - "context"
---

This source is included for **safety contraindications**.

## Why it matters

Useful for implementation safety in home or community sauna contexts.

## Findings captured

- The North American Sauna Society page states UL 875 requires maximum sauna temperature in the US not to exceed 195°F and advises not exceeding that temperature regardless of heater type.
- The page emphasizes UL-listed heaters, licensed electrical work, adequate ventilation, nearby shower/cooling access, and basic layout requirements.

## Protocol takeaway

North American Sauna Society build guidance gives temperature and construction safety guardrails.

## Important limits

Design guidance is not clinical evidence; jurisdictional standards vary.
