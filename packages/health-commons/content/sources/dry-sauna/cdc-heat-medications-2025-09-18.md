---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:cdc-heat-medications-2025-09-18"
slug: "sources/dry-sauna/cdc-heat-medications-2025-09-18"
title: "Heat and Medications – Guidance for Clinicians"
summary: "Heat and Medications – Guidance for Clinicians — safety-only appraisal"
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
  title: "Heat and Medications – Guidance for Clinicians"
  url: "https://cdc.gov/heat-health/hcp/clinical-guidance/heat-and-medications-guidance-for-clinicians.html"
  citation: "Heat and Medications – Guidance for Clinicians. https://cdc.gov/heat-health/hcp/clinical-guidance/heat-and-medications-guidance-for-clinicians.html"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "446d45566380035762a3881c5787313b3697426100001cace70ee1e39d7313db"
    url: "https://cdc.gov/heat-health/hcp/clinical-guidance/heat-and-medications-guidance-for-clinicians.html"
  canonicalUrl: "https://cdc.gov/heat-health/hcp/clinical-guidance/heat-and-medications-guidance-for-clinicians.html"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "Clinicians and patients taking medications during heat exposure"
  durationLabel: "Ambient heat and medication classes that may worsen heat risk"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from safety-contraindications | not found in available source pages, artifact manifests, or referenced content keys | Current clinician guidance for medication classes that may worsen heat risk; not sauna-specific but directly applicable to heat safety screening."
  cohortKey: "cdc-heat-medications-2025-09-18"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "general_guideline"
claimUse: "safety-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:cdc-heat-medications-guidance"
    sourceKey: "source_artifact:cdc-heat-medications-2025-09-18"
    extractedFromArtifactId: "art_cdc_heat_medications_2025_09_18_web"
    findingKind: "safety"
    population: "Clinicians and patients taking medications during heat exposure"
    exposure: "Ambient heat and medication classes that may worsen heat risk"
    outcome: "heat-related illness"
    summary: "CDC clinician guidance states that certain medications can increase heat-related illness risk and recommends medication/heat action planning through mechanisms such as impaired thermoregulation, reduced sweating, dehydration, kidney/electrolyte effects, and altered drug handling."
    evidenceUse:
      - "safety"
---

This source is included for **safety contraindications**.

## Why it matters

Use for medication-screening and heat-safety boundaries; not for efficacy.

## Findings captured

- CDC clinician guidance states that certain medications can increase heat-related illness risk and recommends medication/heat action planning through mechanisms such as impaired thermoregulation, reduced sweating, dehydration, kidney/electrolyte effects, and altered drug handling.

## Protocol takeaway

Heat and Medications – Guidance for Clinicians — safety-only appraisal

## Important limits

General heat guidance, not sauna-specific clinical trial evidence.; Medication plan should be individualized with clinicians.
