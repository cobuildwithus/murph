---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:saunasociety-faqs-2026-04-27"
slug: "sources/dry-sauna/saunasociety-faqs-2026-04-27"
title: "FAQs"
summary: "North American Sauna Society FAQ supports wet/dry humidity context and typical 2–3x/week use."
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
  title: "FAQs"
  url: "https://saunasociety.org/faqs"
  citation: "FAQs. https://saunasociety.org/faqs"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "ca09c15aeac1a7b505b32ed118153eaad8a45783fd6eebaaedf543acdd1d870b"
    url: "https://saunasociety.org/faqs"
  canonicalUrl: "https://saunasociety.org/faqs"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "Traditional Finnish sauna users"
  durationLabel: "Finnish sauna used wet or dry; water ladled on rocks"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from external-protocol-claims | not found in available source pages, artifact manifests, or referenced content keys | Lower-detail but useful expert-society FAQ for ordinary-use frequency and medical-condition caveats."
  cohortKey: "saunasociety-faqs-2026-04-27"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "direct_protocol"
claimUse: "context-only"
murphV1Priority: "medium"
artifactRightsStatusGuess: "unknown"
sourceFindings:

  -
    findingId: "finding:saunasociety-faqs-wet-dry-humidity"
    sourceKey: "source_artifact:saunasociety-faqs-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_faqs_web"
    findingKind: "context"
    population: "Traditional Finnish sauna users"
    exposure: "Finnish sauna used wet or dry; water ladled on rocks"
    outcome: "Humidity control and typical humidity"
    summary: "The North American Sauna Society FAQ explains that Finnish sauna users control humidity by ladling water on rocks; no-water humidity can be under 10%, while typical Finnish sauna humidity with water is about 25–35%."
    evidenceUse:
      - "context"
  -
    findingId: "finding:saunasociety-faqs-children-shorter"
    sourceKey: "source_artifact:saunasociety-faqs-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_faqs_web"
    findingKind: "safety"
    population: "Children using Finnish saunas"
    exposure: "Traditional Finnish sauna"
    outcome: "Child duration caution"
    summary: "The FAQ states most children can use Finnish saunas but should not stay as long as adults because young children do not have well-developed perspiration systems."
    evidenceUse:
      - "safety"
  -
    findingId: "finding:saunasociety-faqs-frequency-2-3-week"
    sourceKey: "source_artifact:saunasociety-faqs-2026-04-27"
    extractedFromArtifactId: "art_saunasociety_faqs_web"
    findingKind: "context"
    population: "Sauna owners/users"
    exposure: "Sauna use frequency"
    outcome: "Typical usage frequency"
    summary: "The FAQ says people use saunas on average two to three times a week, though some use them daily and others sporadically."
    evidenceUse:
      - "context"
---

This source is included for **safety contraindications**.

## Why it matters

Useful operational context for Finnish-sauna modality and frequency framing.

## Findings captured

- The North American Sauna Society FAQ explains that Finnish sauna users control humidity by ladling water on rocks; no-water humidity can be under 10%, while typical Finnish sauna humidity with water is about 25–35%.
- The FAQ states most children can use Finnish saunas but should not stay as long as adults because young children do not have well-developed perspiration systems.
- The FAQ says people use saunas on average two to three times a week, though some use them daily and others sporadically.

## Protocol takeaway

North American Sauna Society FAQ supports wet/dry humidity context and typical 2–3x/week use.

## Important limits

FAQ guidance is not primary evidence and should not be used for efficacy claims.
