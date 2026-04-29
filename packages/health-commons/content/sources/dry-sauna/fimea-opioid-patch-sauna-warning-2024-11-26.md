---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fimea-opioid-patch-sauna-warning-2024-11-26"
slug: "sources/dry-sauna/fimea-opioid-patch-sauna-warning-2024-11-26"
title: "Fimea issues a warning: Wearing an opioid patch in the sauna may cause life-threatening poisoning"
summary: "Fimea issues a warning: Wearing an opioid patch in the sauna may cause life-threatening poisoning — safety-only appraisal"
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
  title: "Fimea issues a warning: Wearing an opioid patch in the sauna may cause life-threatening poisoning"
  url: "https://fimea.fi/en/-/fimea-issues-a-warning-wearing-an-opioid-patch-in-the-sauna-may-cause-life-threatening-poisoning"
  citation: "Fimea issues a warning: Wearing an opioid patch in the sauna may cause life-threatening poisoning. https://fimea.fi/en/-/fimea-issues-a-warning-wearing-an-opioid-patch-in-the-sauna-may-cause-life-threatening-poisoning"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "cae1a28842c3b31fce2f3eefe4c58f51883030b9e24427908aef49c079d2032a"
    url: "https://fimea.fi/en/-/fimea-issues-a-warning-wearing-an-opioid-patch-in-the-sauna-may-cause-life-threatening-poisoning"
  canonicalUrl: "https://fimea.fi/en/-/fimea-issues-a-warning-wearing-an-opioid-patch-in-the-sauna-may-cause-life-threatening-poisoning"
researchEvidence:
  designKind: "guideline"
  designLabel: "Guideline"
  populationLabel: "People using transdermal opioid patches, especially fentanyl patches"
  durationLabel: "Sauna or other external heat while wearing an opioid patch"
  aggregateRole: "context"
  aggregationNote: "source-index.json absent from snapshot; fallback resolution used stable IDs plus visible source pages/artifact manifests/referenced keys | deduped 1 candidate row(s) from snowball-gap-fill | not found in available source pages, artifact manifests, or referenced content keys | Regulatory safety warning; useful for explicit medication-screening language."
  cohortKey: "fimea-opioid-patch-sauna-warning-2024-11-26"
evidenceBucket: "safety_contraindications"
directnessToProtocol: "general_guideline"
claimUse: "safety-only"
murphV1Priority: "high"
artifactRightsStatusGuess: "open_access"
sourceFindings:

  -
    findingId: "finding:fimea-opioid-patch-sauna-warning"
    sourceKey: "source_artifact:fimea-opioid-patch-sauna-warning-2024-11-26"
    extractedFromArtifactId: "art_fimea_opioid_patch_sauna_warning_2024_11_26_web"
    findingKind: "adverse_event"
    population: "People using transdermal opioid patches, especially fentanyl patches"
    exposure: "Sauna or other external heat while wearing an opioid patch"
    outcome: "life-threatening poisoning"
    summary: "Fimea warns that sauna/external heat can increase transdermal opioid delivery and reports five fatal Finnish fentanyl-patch poisoning cases over ten years where sauna was involved; this is a high-priority sauna safety exclusion."
    evidenceUse:
      - "safety"
---

This source is included for **safety contraindications**.

## Why it matters

Use as a prominent hard-stop warning: do not use sauna with transdermal opioid patches; follow medical advice before heat exposure.

## Findings captured

- Fimea warns that sauna/external heat can increase transdermal opioid delivery and reports five fatal Finnish fentanyl-patch poisoning cases over ten years where sauna was involved; this is a high-priority sauna safety exclusion.

## Protocol takeaway

Fimea issues a warning: Wearing an opioid patch in the sauna may cause life-threatening poisoning — safety-only appraisal

## Important limits

Regulatory warning and case surveillance, not an incidence study.; Focused on opioid patches, not all medications.
