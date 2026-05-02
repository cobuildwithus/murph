---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1080-23328940.2026.2645467"
slug: "sources/dry-sauna/doi-10.1080-23328940.2026.2645467"
title: "Acute Finnish sauna heat exposure induces stronger immune cell than cytokine responses"
summary: "Acute Finnish sauna shifted immune-cell counts more clearly than cytokines."
status: "draft"
quality: "usable"
aliases:
  - "DOI 10.1080/23328940.2026.2645467"
categories:
  - "dry-sauna"
  - "acute_mechanistic"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week"
  -
    type: "parent_family"
    target: "experiment_family:dry-sauna"
source:
  kind: "journal_article"
  title: "Acute Finnish sauna heat exposure induces stronger immune cell than cytokine responses"
  authors: "Ilkka H. A. Heinonen, Tiia Koivula, Maija Hollmén, et al."
  journal: "Temperature"
  doi: "10.1080/23328940.2026.2645467"
  url: "https://doi.org/10.1080/23328940.2026.2645467"
  citation: "Acute Finnish sauna heat exposure induces stronger immune cell than cytokine responses. https://doi.org/10.1080/23328940.2026.2645467"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1080/23328940.2026.2645467"
    titleHash: "2641c12c67ea1c2a26e3b53d8a0f2ccc204877c1586f1fed5428421ba25375b5"
    url: "https://doi.org/10.1080/23328940.2026.2645467"
  canonicalUrl: "https://doi.org/10.1080/23328940.2026.2645467"
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "Acute Physiology"
  populationLabel: "Fifty-one middle-aged regular sauna users, including women and men, mostly with at least one cardiovascular risk factor but without active cardiovascular disease."
  durationLabel: "Single acute Finnish-sauna heat exposure, reported by secondary summaries as about 30 minutes at approximately 73 °C and 10-20% relative humidity."
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from acute-mechanistic-physiology | source key already appears in available sauna artifact manifest | New acute Finnish-sauna source with plasma-volume handling; immune endpoints are adjacent to this physiology shard."
  cohortKey: "doi-10.1080-23328940.2026.2645467"
evidenceBucket: "acute_mechanistic"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "medium"
artifactRightsStatusGuess: "open_access"
sourceFindings:

  -
    findingId: "finding:doi-10.1080-23328940.2026.2645467-acute-immune-cell-cytokine-response"
    sourceKey: "source_artifact:doi-10.1080-23328940.2026.2645467"
    extractedFromArtifactId: "art_doi_10.1080_23328940.2026.2645467_pdf"
    findingKind: "mechanistic"
    population: "Fifty-one middle-aged regular sauna users, including women and men, mostly with at least one cardiovascular risk factor but without active cardiovascular disease."
    exposure: "Single acute Finnish-sauna heat exposure, reported by secondary summaries as about 30 minutes at approximately 73 °C and 10-20% relative humidity."
    outcome: "Body temperature, plasma-volume correction context, white blood cell counts/subtypes, and a panel of cytokines measured before, immediately after, and 30 minutes after sauna."
    summary: "The study reported a stronger acute response in circulating immune-cell counts than in cytokines: white blood cells rose after sauna, neutrophils and lymphocytes returned toward baseline by 30 minutes, mixed-cell fractions remained elevated, and most cytokines did not show clear acute change."
    evidenceUse:
      - "mechanism"
      - "context"
---

This source is included for **acute mechanistic**.

## Why it matters

Useful for short-lived mechanistic physiology and recovery-context framing, not for a benefit promise.

## Findings captured

- The study reported a stronger acute response in circulating immune-cell counts than in cytokines: white blood cells rose after sauna, neutrophils and lymphocytes returned toward baseline by 30 minutes, mixed-cell fractions remained elevated, and most cytokines did not show clear acute change.

## Protocol takeaway

Acute Finnish sauna shifted immune-cell counts more clearly than cytokines.

## Important limits

Single-session study in regular sauna users with laboratory immune endpoints and no repeated-protocol outcome test.
