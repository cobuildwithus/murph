---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:buchinger-wilhelmi-fasting-schedule-2023-04-28
slug: sources/prolonged-fasting/buchinger-wilhelmi-fasting-schedule-2023-04-28
title: Our fasting schedule
summary: Buchinger Wilhelmi clinic page describing a medically supervised therapeutic-fasting schedule, daily monitoring, modified fasting nutrition, and limits for unsupervised at-home fasting.
status: draft
quality: usable
aliases:
- Buchinger Wilhelmi fasting schedule
- Fasting schedule at Buchinger Wilhelmi clinics
categories:
- prolonged-fasting
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: external_protocol
  title: Our fasting schedule
  authors: Buchinger Wilhelmi / Barbara Philipps
  year: 2023
  journal: Buchinger Wilhelmi
  citation: Buchinger Wilhelmi. Our fasting schedule. Published 2023-04-28. Accessed for batch-011.
  url: https://buchinger-wilhelmi.com/en/our-fasting-schedule
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://buchinger-wilhelmi.com/en/our-fasting-schedule
    titleHash: b7f0ad1e58d3dca3d8f5c725b2defb5abed35bd0945d6e42d1a15ec57424eabe
  canonicalUrl: https://buchinger-wilhelmi.com/en/our-fasting-schedule
researchEvidence:
  designKind: expert_protocol
  designLabel: External clinic implementation protocol
  populationLabel: Prospective fasting-clinic guests; at-home fasters are discussed as a boundary population.
  durationLabel: Shortest clinic program described as 10 days, including digestive rest, fasting, fast-breaking, and food reintroduction.
  aggregateRole: context
  cohortKey: cohort:prolonged-fasting-buchinger-schedule
evidenceBucket: implementation, hydration, and refeed context
whyItMatters: 'This is not efficacy evidence, but it gives a concrete implementation boundary: the clinic program surrounds fasting days with preparation, monitoring, and refeeding rather than treating fasting as an isolated calorie-abstinence block.'
potentialMurphEndpoints:
- morning blood pressure
- pulse
- body weight
- blood glucose
- symptoms during fast
- refeeding tolerance
protocolTakeaway: 'Use as clinical-supervised implementation context only: do not generalize Buchinger clinic structure into a claim that unsupervised 24–72 hour fasting is safe or effective.'
murphTakeaway: A conservative Murph experiment should separate fasting exposure from preparation, daily monitoring, and refeeding signals.
studyDesign: External clinic protocol / implementation guidance.
modality: Buchinger-style modified therapeutic fasting with clinic supervision.
claimUse: context-only
sourceFindings:
- findingId: finding:buchinger-wilhelmi-fasting-schedule-2023-04-28-clinic-schedule-monitoring-refeed
  findingKind: context
  population: Buchinger Wilhelmi fasting-clinic guests.
  exposure: Shortest described clinic fasting program with digestive rest, fasting days, fast-breaking, and gradual food reintroduction.
  outcome: Implementation sequence and monitoring requirements.
  summary: The clinic describes a shortest ten-day program consisting of a digestive rest day, about six fasting days including fast-breaking, and three days of gradual reintroduction, with typical daily checks of blood pressure, pulse, weight, blood glucose, and symptoms.
  evidenceUse:
  - context
  - safety
  - adjacent_variant
  sourceKey: source_artifact:buchinger-wilhelmi-fasting-schedule-2023-04-28
  extractedFromArtifactId: art_buchinger_wilhelmi_fasting_schedule_2023_04_28_source_record
- findingId: finding:buchinger-wilhelmi-fasting-schedule-2023-04-28-water-fasting-supervision-boundary
  findingKind: safety
  population: People considering at-home long fasting or water fasting.
  exposure: At-home fasting longer than five days or water-only/zero-diet fasting.
  outcome: Supervision boundary.
  summary: The page advises against fasting longer than five days at home and states that a zero diet or water fasting should not be done without medical supervision.
  evidenceUse:
  - safety
  - context
  sourceKey: source_artifact:buchinger-wilhelmi-fasting-schedule-2023-04-28
  extractedFromArtifactId: art_buchinger_wilhelmi_fasting_schedule_2023_04_28_source_record
murphV1Priority: High
pdfRightsStatus: unknown
directnessToProtocol: clinical_supervised
populationMismatch: Clinic guests and people considering at-home fasting do not necessarily match healthy self-experimenters attempting a 24–72 hour protocol.
limitations:
- Clinic webpage; no randomized comparator, no extractable participant count, and claims reflect a commercial clinic protocol.
claimUseBoundary: context-only
---

This source is included for **implementation, hydration, and refeed context**.

**Findings:**
- `finding:buchinger-wilhelmi-fasting-schedule-2023-04-28-clinic-schedule-monitoring-refeed` — The clinic describes a shortest ten-day program consisting of a digestive rest day, about six fasting days including fast-breaking, and three days of gradual reintroduction, with typical daily checks of blood pressure, pulse, weight, blood glucose, and symptoms.
- `finding:buchinger-wilhelmi-fasting-schedule-2023-04-28-water-fasting-supervision-boundary` — The page advises against fasting longer than five days at home and states that a zero diet or water fasting should not be done without medical supervision.

**Why it matters:** This is not efficacy evidence, but it gives a concrete implementation boundary: the clinic program surrounds fasting days with preparation, monitoring, and refeeding rather than treating fasting as an isolated calorie-abstinence block.

**Potential experiment signals:** morning blood pressure, pulse, body weight, blood glucose, symptoms during fast, refeeding tolerance.

**Protocol takeaway:** Use as clinical-supervised implementation context only: do not generalize Buchinger clinic structure into a claim that unsupervised 24–72 hour fasting is safe or effective.

**Directness to Prolonged Fasting (24–72 Hours):** `clinical_supervised`.

**Population mismatch:** Clinic guests and people considering at-home fasting do not necessarily match healthy self-experimenters attempting a 24–72 hour protocol.

**Limitations:** Clinic webpage; no randomized comparator, no extractable participant count, and claims reflect a commercial clinic protocol.

**Claim use:** `context-only`.

**Artifact and rights note:** Source page draft only. PDF rights status: `unknown`. No copyrighted PDF content is included.
