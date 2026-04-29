---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:protocol-bryanjohnson-sauna-2026-04-27"
slug: "sources/dry-sauna/protocol-bryanjohnson-sauna-2026-04-27"
title: "DON'T DIE Protocol: Sauna"
summary: "Blueprint external protocol overlaps Murph temperature/duration but is based on a self-experiment and public guidance."
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
  kind: "external_protocol"
  title: "DON'T DIE Protocol: Sauna"
  url: "https://protocol.bryanjohnson.com/"
  citation: "DON'T DIE Protocol: Sauna. https://protocol.bryanjohnson.com/"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "a8c887b4abe906cbbda315fb467a2ccf59bd7626e39930fff43f83c15f3cb9b6"
    url: "https://protocol.bryanjohnson.com/"
  canonicalUrl: "https://protocol.bryanjohnson.com/"
researchEvidence:
  designKind: "other"
  designLabel: "Other"
  populationLabel: "Bryan Johnson self-experiment / Blueprint audience"
  durationLabel: "Dry sauna at 200°F/93°C, 20 min, daily, after morning workout"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | not found in available source pages, artifact manifests, or referenced content keys | Live protocol page gives claim language, contraindication list, and implementation tips that should be source-attributed and separated from evidence claims."
  cohortKey: "protocol-bryanjohnson-sauna-2026-04-27"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:bryanjohnson-protocol-personal-daily-93c"
    sourceKey: "source_artifact:protocol-bryanjohnson-sauna-2026-04-27"
    extractedFromArtifactId: "art_bryanjohnson_sauna_protocol_web"
    findingKind: "context"
    population: "Bryan Johnson self-experiment / Blueprint audience"
    exposure: "Dry sauna at 200°F/93°C, 20 min, daily, after morning workout"
    outcome: "External personal protocol"
    summary: "Bryan Johnson reports a personal dry-sauna protocol of 93°C for 20 minutes daily, with low humidity, post-workout timing, groin/head heat-protection, and electrolyte rehydration."
    evidenceUse:
      - "context"
  -
    findingId: "finding:bryanjohnson-protocol-home-80-100-3-5"
    sourceKey: "source_artifact:protocol-bryanjohnson-sauna-2026-04-27"
    extractedFromArtifactId: "art_bryanjohnson_sauna_protocol_web"
    findingKind: "context"
    population: "General Blueprint audience"
    exposure: "Dry sauna at 80–100°C for 15–20 min, 3–5 times/week"
    outcome: "External home protocol guidance"
    summary: "The Blueprint page suggests home sauna at 80–100°C, 15–20 minutes, 3–5 times per week, aiming at the lower end for beginners."
    evidenceUse:
      - "context"
  -
    findingId: "finding:bryanjohnson-protocol-contraindications"
    sourceKey: "source_artifact:protocol-bryanjohnson-sauna-2026-04-27"
    extractedFromArtifactId: "art_bryanjohnson_sauna_protocol_web"
    findingKind: "safety"
    population: "General Blueprint audience"
    exposure: "Sauna use"
    outcome: "Contraindications/cautions"
    summary: "The page advises skipping sauna with serious heart issues, uncontrolled blood pressure, pregnancy without medical consultation, infection/fever, seizure history, respiratory conditions, inflamed skin, recent alcohol/recreational drugs, and selected medications."
    evidenceUse:
      - "safety"
---

This source is included for **safety contraindications**.

## Why it matters

Useful comparator for community protocols and safety cautions; not direct clinical evidence.

## Findings captured

- Bryan Johnson reports a personal dry-sauna protocol of 93°C for 20 minutes daily, with low humidity, post-workout timing, groin/head heat-protection, and electrolyte rehydration.
- The Blueprint page suggests home sauna at 80–100°C, 15–20 minutes, 3–5 times per week, aiming at the lower end for beginners.
- The page advises skipping sauna with serious heart issues, uncontrolled blood pressure, pregnancy without medical consultation, infection/fever, seizure history, respiratory conditions, inflamed skin, recent alcohol/recreational drugs, and selected medications.

## Protocol takeaway

Blueprint external protocol overlaps Murph temperature/duration but is based on a self-experiment and public guidance.

## Important limits

Self-experiment and branded protocol context; claims should not be treated as generalized efficacy evidence.
