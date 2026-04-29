---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:saunasociety-sauna-experience-2026-04-27"
slug: "sources/dry-sauna/saunasociety-sauna-experience-2026-04-27"
title: "Sauna Experience"
summary: "Sauna Society distinguishes traditional Finnish sauna humidity control from very-low-humidity dry sauna."
status: "draft"
quality: "usable"
categories:
  - "dry-sauna"
  - "external_protocol_claims"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
source:
  kind: "external_protocol"
  title: "Sauna Experience"
  url: "https://saunasociety.org/sauna-experience"
  citation: "Sauna Experience. https://saunasociety.org/sauna-experience"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "85ad93fd7a21cc070692ec53b8befd0bd4faa743865accba4ea752b8d35e8dbe"
    url: "https://saunasociety.org/sauna-experience"
  canonicalUrl: "https://saunasociety.org/sauna-experience"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "General sauna users; educational guidance, not a study cohort"
  durationLabel: "Traditional Finnish sauna"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | not found in available source pages, artifact manifests, or referenced content keys | Clarifies terminology: dry sauna, Finnish sauna with water on rocks, steam rooms, and infrared differ materially for protocol boundaries."
  cohortKey: "saunasociety-sauna-experience-2026-04-27"
evidenceBucket: "external_protocol_claims"
directnessToProtocol: "general_guideline"
claimUse: "context-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:saunasociety-sauna-experience-2026-04-27-finnish-sauna-heat-humidity"
    sourceKey: "source_artifact:saunasociety-sauna-experience-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_sauna_experience_2026_04_27_html"
    findingKind: "context"
    population: "General sauna users; educational guidance, not a study cohort"
    exposure: "Traditional Finnish sauna"
    outcome: "Modality definition: heat and humidity"
    summary: "The North American Sauna Society describes traditional Finnish sauna as wood-lined and defined by minimum heat and humidity control, with at least 150°F (65.5°C) measured where bathers sit."
    evidenceUse:
      - "context"
  -
    findingId: "finding:saunasociety-sauna-experience-2026-04-27-dry-sauna-low-humidity"
    sourceKey: "source_artifact:saunasociety-sauna-experience-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_sauna_experience_2026_04_27_html"
    findingKind: "context"
    population: "General sauna users; educational guidance, not a study cohort"
    exposure: "Dry sauna without water ladled onto rocks"
    outcome: "Modality definition: dry-sauna humidity"
    summary: "The page describes dry sauna as basically a traditional Finnish sauna without water ladled onto rocks, producing very low humidity often below 10%."
    evidenceUse:
      - "context"
  -
    findingId: "finding:saunasociety-sauna-experience-2026-04-27-water-on-rocks"
    sourceKey: "source_artifact:saunasociety-sauna-experience-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_sauna_experience_2026_04_27_html"
    findingKind: "context"
    population: "General sauna users; educational guidance, not a study cohort"
    exposure: "Water on heated sauna rocks"
    outcome: "Humidity practice and public-sauna etiquette"
    summary: "The page states that water and a ladle are essential to the traditional sauna experience, that not putting water on hot rocks is a misconception, and that humidity level is personal but should respect public-sauna rules and other bathers."
    evidenceUse:
      - "context"
      - "safety"
---

This source is included for **external protocol claims**.

## Why it matters

Helps define modality boundaries and avoid implying that all Finnish sauna practice is fully dry.

## Findings captured

- The North American Sauna Society describes traditional Finnish sauna as wood-lined and defined by minimum heat and humidity control, with at least 150°F (65.5°C) measured where bathers sit.
- The page describes dry sauna as basically a traditional Finnish sauna without water ladled onto rocks, producing very low humidity often below 10%.
- The page states that water and a ladle are essential to the traditional sauna experience, that not putting water on hot rocks is a misconception, and that humidity level is personal but should respect public-sauna rules and other bathers.

## Protocol takeaway

Sauna Society distinguishes traditional Finnish sauna humidity control from very-low-humidity dry sauna.

## Important limits

Educational guidance only; no participant outcomes or efficacy data.
