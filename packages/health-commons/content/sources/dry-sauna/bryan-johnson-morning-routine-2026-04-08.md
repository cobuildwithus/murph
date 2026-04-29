---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:bryan-johnson-morning-routine-2026-04-08"
slug: "sources/dry-sauna/bryan-johnson-morning-routine-2026-04-08"
title: "My Morning Routine (2026)"
summary: "Public daily routine reports 20 min at 200°F with heat-protection add-ons."
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
  title: "My Morning Routine (2026)"
  url: "https://blueprint.bryanjohnson.com/blogs/news/morning-routine"
  citation: "My Morning Routine (2026). https://blueprint.bryanjohnson.com/blogs/news/morning-routine"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "012ea25d834ff2d1d1ad8d55ebc6490baf7410561e96e84ba2722cae061a4e69"
    url: "https://blueprint.bryanjohnson.com/blogs/news/morning-routine"
  canonicalUrl: "https://blueprint.bryanjohnson.com/blogs/news/morning-routine"
researchEvidence:
  designKind: "other"
  designLabel: "Other"
  populationLabel: "Bryan Johnson; adult male self-tracker; no formal study cohort"
  durationLabel: "Daily morning dry sauna after exercise, 20 min at 200°F (93°C)"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | source key already referenced in available sauna/dry-sauna content graph | Confirms current routine placement in morning stack and notes evolving experimental cooling tactics."
  cohortKey: "bryan-johnson-morning-routine-2026-04-08"
evidenceBucket: "external_protocol_claims"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:bryan-johnson-morning-routine-2026-04-08-daily-20min-200f"
    sourceKey: "source_artifact:bryan-johnson-morning-routine-2026-04-08"
    extractedFromArtifactId: "art_bryan_johnson_morning_routine_2026_04_08_html"
    findingKind: "context"
    population: "Bryan Johnson; adult male self-tracker; no formal study cohort"
    exposure: "Daily morning dry sauna after exercise, 20 min at 200°F (93°C)"
    outcome: "Routine dose parameters and post-sauna temperature self-report"
    summary: "Bryan Johnson reports a daily 20 min sauna at 200°F (93°C) with a post-sauna ear temperature of 102.4°F (39°C)."
    evidenceUse:
      - "adjacent_variant"
      - "context"
      - "measurement"
  -
    findingId: "finding:bryan-johnson-morning-routine-2026-04-08-heat-protection"
    sourceKey: "source_artifact:bryan-johnson-morning-routine-2026-04-08"
    extractedFromArtifactId: "art_bryan_johnson_morning_routine_2026_04_08_html"
    findingKind: "safety"
    population: "Bryan Johnson; adult male self-tracker; no formal study cohort"
    exposure: "Daily high-heat sauna with added heat-protection measures"
    outcome: "Fertility, scalp, and skin-protection practices"
    summary: "The routine lists ice packs on the testes, a wool hat, and experimental face and neck cooling to protect fertility markers, hair/scalp, and skin from heat exposure."
    evidenceUse:
      - "context"
      - "safety"
---

This source is included for **external protocol claims**.

## Why it matters

Useful for external-protocol context and measurement targets, but it does not provide controlled evidence for the Murph 3x/week protocol.

## Findings captured

- Bryan Johnson reports a daily 20 min sauna at 200°F (93°C) with a post-sauna ear temperature of 102.4°F (39°C).
- The routine lists ice packs on the testes, a wool hat, and experimental face and neck cooling to protect fertility markers, hair/scalp, and skin from heat exposure.

## Protocol takeaway

Public daily routine reports 20 min at 200°F with heat-protection add-ons.

## Important limits

Daily frequency, post-exercise timing, extensive co-interventions, and ear-temperature measurement limit directness.
