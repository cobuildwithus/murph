---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:sauna-fi-health-effects-2026-04-27"
slug: "sources/dry-sauna/sauna-fi-health-effects-2026-04-27"
title: "Sauna and Health effects"
summary: "Finnish Sauna Society summarizes circulation, sweating, relaxation, and cold-swim safety context."
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
  title: "Sauna and Health effects"
  authors: "Finnish Sauna Society"
  journal: "Finnish Sauna Society"
  url: "https://sauna.fi/en/sauna-knowledge/sauna-and-health-effects"
  citation: "Sauna and Health effects. https://sauna.fi/en/sauna-knowledge/sauna-and-health-effects"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "47fdca7e52cebad8827a1b82e03b07304ce28e19fdabdac542a8f4bbe23db3cd"
    url: "https://sauna.fi/en/sauna-knowledge/sauna-and-health-effects"
  canonicalUrl: "https://sauna.fi/en/sauna-knowledge/sauna-and-health-effects"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Narrative Review"
  populationLabel: "General sauna users described in Finnish Sauna Society educational page"
  durationLabel: "Sauna bathing"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | not found in available source pages, artifact manifests, or referenced content keys | Society health-context page includes both reassuring and cautionary statements; useful for preserving mixed guidance rather than overclaiming."
  cohortKey: "sauna-fi-health-effects-2026-04-27"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "general_guideline"
claimUse: "context-only"
murphV1Priority: "medium"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:sauna-fi-health-effects-circulation"
    sourceKey: "source_artifact:sauna-fi-health-effects-2026-04-27"
    extractedFromArtifactId: "art_sauna_fi_health_effects_web"
    findingKind: "mechanistic"
    population: "General sauna users described in Finnish Sauna Society educational page"
    exposure: "Sauna bathing"
    outcome: "Skin temperature, heart rate, circulation and urine output"
    summary: "The Finnish Sauna Society page states skin temperature and heart rate rise in sauna, urine output decreases due to sweating, vessels dilate, and a large share of blood flow may circulate through the skin during heat exposure."
    evidenceUse:
      - "mechanism"
      - "context"
  -
    findingId: "finding:sauna-fi-health-effects-cold-swim-risk"
    sourceKey: "source_artifact:sauna-fi-health-effects-2026-04-27"
    extractedFromArtifactId: "art_sauna_fi_health_effects_web"
    findingKind: "safety"
    population: "Sauna users who swim/cold plunge after sauna, especially people with heart failure"
    exposure: "Swimming/cold exposure after sauna"
    outcome: "Blood pressure rise and arrhythmia/weakness risk"
    summary: "The page warns that swimming after sauna makes skin vessels contract and blood pressure rise quickly, which may be dangerous for individuals with heart failure and can cause weakness or serious arrhythmia."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:sauna-fi-health-effects-relaxation-boundary"
    sourceKey: "source_artifact:sauna-fi-health-effects-2026-04-27"
    extractedFromArtifactId: "art_sauna_fi_health_effects_web"
    findingKind: "context"
    population: "General Finnish sauna users"
    exposure: "Sauna bathing"
    outcome: "Relaxation"
    summary: "The page frames relaxation as a major health benefit, while acknowledging mechanistic uncertainty and mixed reliability of some hormonal findings."
    evidenceUse:
      - "context"
      - "mechanism"
---

This source is included for **safety contraindications**.

## Why it matters

Useful for mechanism framing and cold-plunge cautions, not for quantified efficacy claims.

## Findings captured

- The Finnish Sauna Society page states skin temperature and heart rate rise in sauna, urine output decreases due to sweating, vessels dilate, and a large share of blood flow may circulate through the skin during heat exposure.
- The page warns that swimming after sauna makes skin vessels contract and blood pressure rise quickly, which may be dangerous for individuals with heart failure and can cause weakness or serious arrhythmia.
- The page frames relaxation as a major health benefit, while acknowledging mechanistic uncertainty and mixed reliability of some hormonal findings.

## Protocol takeaway

Finnish Sauna Society summarizes circulation, sweating, relaxation, and cold-swim safety context.

## Important limits

Educational page based on a talk and literature summary; not a primary study.
