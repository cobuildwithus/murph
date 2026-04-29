---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:cdc-physical-activity-intensity-2025-12-04"
slug: "sources/aerobic-base-training/cdc-physical-activity-intensity-2025-12-04"
title: "How to Measure Physical Activity Intensity"
summary: "CDC describes moderate-intensity activity as activity where a person can talk but not sing, and vigorous-intensity activity as activity where a person cannot say more than a few words without pausing for breath."
status: "draft"
quality: "usable"
aliases:
  - "CDC talk test"
  - "cdc-physical-activity-intensity-2025-12-04"
  - "How to Measure Physical Activity Intensity"
categories:
  - "aerobic-base-training"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:aerobic-base-training/zone-2-aerobic-base-block"
  -
    type: "parent_family"
    target: "experiment_family:aerobic-base-training"
source:
  kind: "web_page"
  title: "How to Measure Physical Activity Intensity"
  authors: "Centers for Disease Control and Prevention"
  year: 2025
  journal: "CDC Physical Activity Basics"
  citation: "Centers for Disease Control and Prevention. How to Measure Physical Activity Intensity. CDC Physical Activity Basics. Accessed 2026-04-26."
  url: "https://www.cdc.gov/physical-activity-basics/measuring/index.html"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "38d89c497d155ffac7f343970cf7ef3e36625f812445ab3effa244373e960eff"
    url: "https://www.cdc.gov/physical-activity-basics/measuring/index.html"
  canonicalUrl: "https://www.cdc.gov/physical-activity-basics/measuring/index.html"
researchEvidence:
  designKind: "guideline"
  designLabel: "CDC public-health intensity guidance"
  populationLabel: "General public seeking practical physical-activity intensity guidance"
  durationLabel: "Measurement guidance; no intervention follow-up"
  aggregateRole: "primary"
  cohortKey: "cdc-physical-activity-intensity-2025-12-04"
  notes:
    - "Public guidance rather than a validation trial."
    - "The talk test approximates intensity and can be affected by respiratory disease, speech patterns, hills, heat, and anxiety."
    - "Population mismatch: General public guidance; may be less reliable for people with speech, pulmonary, or cardiac limitations."
evidenceBucket: "direct_protocol_and_dose_evidence"
whyItMatters: "Plain-language authority for the protocol’s conversational-intensity check."
potentialMurphEndpoints:
  - "talk test"
  - "moderate intensity"
  - "vigorous intensity"
  - "intensity self-monitoring"
protocolTakeaway: "Use as the operational intensity rule: during Zone 2/easy cardio, users should be able to converse, with singing difficult; losing the ability to speak in phrases suggests the effort is too hard."
murphTakeaway: "Add a simple in-session talk-test checkpoint and treat frequent failures as an intensity-fidelity issue, not a fitness failure."
studyDesign: "guideline"
modality: "Talk-test physical activity intensity guidance"
claimUse: "supports-protocol"
sourceFindings:

  -
    findingId: "finding:cdc-physical-activity-intensity-talk-test"
    sourceKey: "source_artifact:cdc-physical-activity-intensity-2025-12-04"
    findingKind: "measurement_validation"
    population: "General public seeking practical physical-activity intensity guidance"
    exposure: "Talk-test rule for moderate and vigorous physical activity intensity"
    outcome: "talk test; moderate intensity; vigorous intensity; intensity self-monitoring"
    summary: "CDC describes moderate-intensity activity as activity where a person can talk but not sing, and vigorous-intensity activity as activity where a person cannot say more than a few words without pausing for breath."
    evidenceUse:
      - "measurement"
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---

This source is included for **direct_protocol_and_dose_evidence**.

## Findings

- **measurement_validation: talk test; moderate intensity; vigorous intensity; intensity self-monitoring** — CDC describes moderate-intensity activity as activity where a person can talk but not sing, and vigorous-intensity activity as activity where a person cannot say more than a few words without pausing for breath.

## Why it matters

Plain-language authority for the protocol’s conversational-intensity check.

## Potential experiment signals

- talk test
- moderate intensity
- vigorous intensity
- intensity self-monitoring

## Protocol takeaway

Use as the operational intensity rule: during Zone 2/easy cardio, users should be able to converse, with singing difficult; losing the ability to speak in phrases suggests the effort is too hard.

## Claim use

`supports-protocol`.

## Directness and limitations

Directness to the target protocol: measurement_context. Public guidance rather than a validation trial. The talk test approximates intensity and can be affected by respiratory disease, speech patterns, hills, heat, and anxiety. Population mismatch: General public guidance; may be less reliable for people with speech, pulmonary, or cardiac limitations.

### packages/health-commons/content/sources/aerobic-base-training/health-gov-au-adult-24-hour-movement-guidelines-2026-03-13.md
