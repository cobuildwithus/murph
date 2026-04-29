---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:health.gov-physical-activity-guidelines-2018-11-12"
slug: "sources/aerobic-base-training/health.gov-physical-activity-guidelines-2018-11-12"
title: "Physical Activity Guidelines for Americans, 2nd edition"
summary: "The 2018 U.S. guideline anchors adult aerobic activity at 150–300 minutes/week of moderate-intensity activity or 75–150 minutes/week of vigorous activity, with additional recommendations to move more, sit less, and spread activity through the week."
status: "draft"
quality: "usable"
aliases:
  - "Physical Activity Guidelines for Americans 2nd edition"
  - "health.gov-physical-activity-guidelines-2018-11-12"
  - "Physical Activity Guidelines for Americans, 2nd edition"
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
  kind: "guideline"
  title: "Physical Activity Guidelines for Americans, 2nd edition"
  authors: "U.S. Department of Health and Human Services"
  year: 2018
  journal: "Office of Disease Prevention and Health Promotion"
  citation: "U.S. Department of Health and Human Services. Physical Activity Guidelines for Americans, 2nd edition. Washington, DC: U.S. Department of Health and Human Services; 2018."
  url: "https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "title_hash"
  identifiers:
    titleHash: "f4b597e97f046a152d69bfe734ed1dfbf3d986f22f9199a472c4c7d63dd9aaf3"
    url: "https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf"
  canonicalUrl: "https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "U.S. federal physical activity guideline"
  populationLabel: "U.S. adults, older adults, children, pregnant/postpartum people, and people with chronic conditions or disabilities"
  durationLabel: "Weekly dose guidance; no trial follow-up"
  aggregateRole: "primary"
  cohortKey: "health.gov-physical-activity-guidelines-2018-11-12"
  notes:
    - "Guideline synthesis rather than a primary trial of 3 sessions/week for 4 weeks."
    - "Does not validate the conversational/talk-test rule itself or quantify expected 4-week biomarker changes."
    - "Population mismatch: Broad population-level guidance; individual medical clearance may be needed for people with symptoms, unstable disease, or exercise restrictions."
evidenceBucket: "direct_protocol_and_dose_evidence"
whyItMatters: "High-authority public-health dose anchor for why a 3x/week 35–60 minute block fits within a moderate-intensity aerobic-activity pattern, while not being a trial of this exact 4-week protocol."
potentialMurphEndpoints:
  - "weekly aerobic minutes"
  - "moderate-intensity activity"
  - "session frequency"
  - "public-health safety boundaries"
protocolTakeaway: "Use as a dose-context backbone: the target block delivers 105–180 minutes/week of easy conversational cardio, overlapping the lower-to-mid guideline range for moderate aerobic activity."
murphTakeaway: "Track weekly minutes and perceived intensity; the protocol can be framed as a practical route toward guideline-level aerobic volume rather than a disease treatment."
studyDesign: "guideline"
modality: "Moderate-intensity aerobic physical activity guidance"
claimUse: "supports-protocol"
sourceFindings:

  -
    findingId: "finding:health.gov-physical-activity-guidelines-2018-adult-dose-anchor"
    sourceKey: "source_artifact:health.gov-physical-activity-guidelines-2018-11-12"
    findingKind: "context"
    population: "U.S. adults, older adults, children, pregnant/postpartum people, and people with chronic conditions or disabilities"
    exposure: "Weekly aerobic physical activity recommendations with moderate- and vigorous-intensity options"
    outcome: "weekly aerobic minutes; moderate-intensity activity; session frequency; public-health safety boundaries"
    summary: "The 2018 U.S. guideline anchors adult aerobic activity at 150–300 minutes/week of moderate-intensity activity or 75–150 minutes/week of vigorous activity, with additional recommendations to move more, sit less, and spread activity through the week."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---

This source is included for **direct_protocol_and_dose_evidence**.

## Findings

- **context: weekly aerobic minutes; moderate-intensity activity; session frequency; public-health safety boundaries** — The 2018 U.S. guideline anchors adult aerobic activity at 150–300 minutes/week of moderate-intensity activity or 75–150 minutes/week of vigorous activity, with additional recommendations to move more, sit less, and spread activity through the week.

## Why it matters

High-authority public-health dose anchor for why a 3x/week 35–60 minute block fits within a moderate-intensity aerobic-activity pattern, while not being a trial of this exact 4-week protocol.

## Potential experiment signals

- weekly aerobic minutes
- moderate-intensity activity
- session frequency
- public-health safety boundaries

## Protocol takeaway

Use as a dose-context backbone: the target block delivers 105–180 minutes/week of easy conversational cardio, overlapping the lower-to-mid guideline range for moderate aerobic activity.

## Claim use

`supports-protocol`.

## Directness and limitations

Directness to the target protocol: general_guideline. Guideline synthesis rather than a primary trial of 3 sessions/week for 4 weeks. Does not validate the conversational/talk-test rule itself or quantify expected 4-week biomarker changes. Population mismatch: Broad population-level guidance; individual medical clearance may be needed for people with symptoms, unstable disease, or exercise restrictions.

### packages/health-commons/content/sources/aerobic-base-training/cdc-adult-physical-activity-guidelines-2023-12-20.md
