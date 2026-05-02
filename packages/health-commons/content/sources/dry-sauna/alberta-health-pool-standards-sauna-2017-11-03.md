---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:alberta-health-pool-standards-sauna-2017-11-03"
slug: "sources/dry-sauna/alberta-health-pool-standards-sauna-2017-11-03"
title: "Pool Standards, July 2014 (Amended 2017)"
summary: "Alberta public-pool standards set operational sauna temperature and monitoring requirements."
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
  title: "Pool Standards, July 2014 (Amended 2017)"
  authors: Alberta Health
  journal: Government of Alberta
  url: "https://open.alberta.ca/publications/9781460135990"
  citation: "Pool Standards, July 2014 (Amended 2017). https://open.alberta.ca/publications/9781460135990"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "6481b31cf4234c887177404247b6043795a558deebc59529c6925468934ec07a"
    url: "https://open.alberta.ca/publications/9781460135990"
  canonicalUrl: "https://open.alberta.ca/publications/9781460135990"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "Public swimming pool premises / public sauna operators in Alberta"
  durationLabel: "Dry sauna operation"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from reviews-meta-guidelines | not found in available source pages, artifact manifests, or referenced content keys | Operational temperature and monitoring standard; useful as external safety framing, not clinical evidence."
  cohortKey: "alberta-health-pool-standards-sauna-2017-11-03"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "general_guideline"
claimUse: "safety-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "open_access"
sourceFindings:

  -
    findingId: "finding:alberta-health-pool-standards-dry-sauna-max-temperature"
    sourceKey: "source_artifact:alberta-health-pool-standards-sauna-2017-11-03"
    extractedFromArtifactId: "art_alberta_health_pool_standards_pdf"
    findingKind: "safety"
    population: "Public swimming pool premises / public sauna operators in Alberta"
    exposure: "Dry sauna operation"
    outcome: "Maximum ambient air temperature"
    summary: "Alberta pool standards set a dry-sauna maximum ambient air temperature of 85°C and a steam-sauna maximum of 60°C."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:alberta-health-pool-standards-monitoring-timing-sanitation"
    sourceKey: "source_artifact:alberta-health-pool-standards-sauna-2017-11-03"
    extractedFromArtifactId: "art_alberta_health_pool_standards_pdf"
    findingKind: "safety"
    population: "Public sauna operators"
    exposure: "Sauna facility operation"
    outcome: "Temperature logs, length-of-stay monitoring, physician-consult signage and sanitation planning"
    summary: "The standards require ambient sauna temperature measurement/recording when in use, provisions to help patrons monitor length of stay, and sanitation planning for dry and steam saunas."
    evidenceUse:
      - "safety"
      - "context"
---

This source is included for **safety contraindications**.

## Why it matters

Useful for safety operations, signage, clocks/timers, and upper-temperature guardrails.

## Findings captured

- Alberta pool standards set a dry-sauna maximum ambient air temperature of 85°C and a steam-sauna maximum of 60°C.
- The standards require ambient sauna temperature measurement/recording when in use, provisions to help patrons monitor length of stay, and sanitation planning for dry and steam saunas.

## Protocol takeaway

Alberta public-pool standards set operational sauna temperature and monitoring requirements.

## Important limits

Regulatory standard for public facilities; not a health-outcome study and not necessarily intended for private home sauna protocols.
