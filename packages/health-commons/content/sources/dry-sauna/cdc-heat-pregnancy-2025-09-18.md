---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:cdc-heat-pregnancy-2025-09-18"
slug: "sources/dry-sauna/cdc-heat-pregnancy-2025-09-18"
title: "Clinical Overview of Heat and Pregnancy"
summary: "Clinical Overview of Heat and Pregnancy — safety-only appraisal"
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
  title: "Clinical Overview of Heat and Pregnancy"
  authors: "Centers for Disease Control and Prevention"
  journal: "CDC Heat Health"
  url: "https://cdc.gov/heat-health/hcp/clinical-overview/heat-and-pregnant-women.html"
  citation: "Clinical Overview of Heat and Pregnancy. https://cdc.gov/heat-health/hcp/clinical-overview/heat-and-pregnant-women.html"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "6f973bc2b0429c6403feb49dd24c93532925b3c1dd76d67b6948eb44cb809385"
    url: "https://cdc.gov/heat-health/hcp/clinical-overview/heat-and-pregnant-women.html"
  canonicalUrl: "https://cdc.gov/heat-health/hcp/clinical-overview/heat-and-pregnant-women.html"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "Pregnant people and clinicians caring for pregnant patients"
  durationLabel: "Heat exposure during pregnancy"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from safety-contraindications | not found in available source pages, artifact manifests, or referenced content keys | Current public-health guidance for pregnancy heat vulnerability and counseling; not sauna-specific."
  cohortKey: "cdc-heat-pregnancy-2025-09-18"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "general_guideline"
claimUse: "safety-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:cdc-heat-pregnancy-guidance"
    sourceKey: "source_artifact:cdc-heat-pregnancy-2025-09-18"
    extractedFromArtifactId: "art_cdc_heat_pregnancy_2025_09_18_web"
    findingKind: "safety"
    population: "Pregnant people and clinicians caring for pregnant patients"
    exposure: "Heat exposure during pregnancy"
    outcome: "pregnancy heat risk"
    summary: "CDC clinician guidance states heat exposure can be harmful during pregnancy, can be dangerous in any trimester, and may interact with some medications; it supports conservative pregnancy heat precautions for sauna protocols."
    evidenceUse:
      - "safety"
---

This source is included for **safety contraindications**.

## Why it matters

Use for pregnancy safety exclusion/caution and clinician-review language.

## Findings captured

- CDC clinician guidance states heat exposure can be harmful during pregnancy, can be dangerous in any trimester, and may interact with some medications; it supports conservative pregnancy heat precautions for sauna protocols.

## Protocol takeaway

Clinical Overview of Heat and Pregnancy — safety-only appraisal

## Important limits

General heat/pregnancy guidance, not sauna-specific trial evidence.; Does not specify Finnish sauna dose thresholds.
