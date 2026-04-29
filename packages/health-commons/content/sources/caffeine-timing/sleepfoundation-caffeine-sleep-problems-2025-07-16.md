---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sleepfoundation-caffeine-sleep-problems-2025-07-16
slug: sources/caffeine-timing/sleepfoundation-caffeine-sleep-problems-2025-07-16
title: Caffeine and Sleep Problems
summary: A public Sleep Foundation page popularizes avoiding caffeine in the hours before bedtime, including an 8-hour cutoff framing; it is external guidance, not primary evidence.
status: draft
quality: usable
aliases:
- Caffeine and Sleep Problems
- source_artifact:sleepfoundation-caffeine-sleep-problems-2025-07-16
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: Caffeine and Sleep Problems
  authors: Sleep Foundation
  year: 2025
  journal: Sleep Foundation
  citation: Sleep Foundation. Caffeine and Sleep Problems. Updated July 16, 2025. https://www.sleepfoundation.org/nutrition/caffeine-and-sleep.
  url: https://www.sleepfoundation.org/nutrition/caffeine-and-sleep
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: ed3bc81a6a1b8dc1231d8f87b7f73ab9beb16e0b6fd62eca24fba2d1bb61ed92
    url: https://www.sleepfoundation.org/nutrition/caffeine-and-sleep
  canonicalUrl: https://www.sleepfoundation.org/nutrition/caffeine-and-sleep
researchEvidence:
  designKind: guideline
  designLabel: Consumer sleep guidance web page
  populationLabel: General consumer audience.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: sleepfoundation-caffeine-sleep-problems-2025-07-16-general-consumer-audience
  notes:
  - 'Intervention or exposure: Public advice to avoid caffeine close to bedtime, including at least 8 hours in related page wording.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Sleep problems and general sleep quality.'
  - 'Effect or direction: External guidance, not original effect estimates.'
  - 'Safety notes: General caution about caffeine and sleep; no adverse-event dataset.'
  - 'Limitations: Consumer web page; should not be treated as primary evidence.'
  - 'Population mismatch: General audience, not protocol participants.'
  - 'Directness to target protocol: External protocol-claim context only.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It is a high-visibility external claim source for the 8-hour caffeine cutoff used in public sleep advice.
potentialMurphEndpoints:
- Sleep onset
- Sleep quality
- Caffeine timing adherence
protocolTakeaway: Use only for claim-boundary auditing and to trace public 8-hour cutoff wording back to primary sources.
murphTakeaway: Public guidance supports a simple bedtime buffer, but the protocol page should cite primary trials/reviews for efficacy claims.
studyDesign: other
modality: consumer-guidance
claimUse: context-only
sourceFindings:
- findingId: finding:sleepfoundation-caffeine-sleep-problems-2025-07-16-eight-hour-public-guidance
  sourceKey: source_artifact:sleepfoundation-caffeine-sleep-problems-2025-07-16
  extractedFromArtifactId: art_sleepfoundation_caffeine_sleep_problems_2025_07_16_html
  findingKind: context
  population: General consumer audience.
  exposure: Sleep Foundation caffeine timing advice.
  outcome: Public recommendation to avoid caffeine before bedtime.
  summary: The page presents public guidance to avoid caffeine close to bedtime and popularizes an 8-hour cutoff framing, but it is not primary causal evidence.
  evidenceUse:
  - context
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** The page presents public guidance to avoid caffeine close to bedtime and popularizes an 8-hour cutoff framing, but it is not primary causal evidence.

**Why it matters:** It is a high-visibility external claim source for the 8-hour caffeine cutoff used in public sleep advice.

**Potential experiment signals:** Sleep onset; Sleep quality; Caffeine timing adherence.

**Protocol takeaway:** Use only for claim-boundary auditing and to trace public 8-hour cutoff wording back to primary sources.

**Claim use:** `context-only`.
