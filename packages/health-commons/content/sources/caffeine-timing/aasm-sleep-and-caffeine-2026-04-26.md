---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:aasm-sleep-and-caffeine-2026-04-26
slug: sources/caffeine-timing/aasm-sleep-and-caffeine-2026-04-26
title: Sleep and Caffeine | Benefits and Risks
summary: AASM Sleep Education explains caffeine benefits/risks and cites a study in which caffeine 6 hours before bedtime reduced total sleep time; it is public guidance, not a protocol trial.
status: draft
quality: usable
aliases:
- Sleep and Caffeine | Benefits and Risks
- source_artifact:aasm-sleep-and-caffeine-2026-04-26
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: Sleep and Caffeine | Benefits and Risks
  authors: American Academy of Sleep Medicine / Sleep Education
  year: 2026
  journal: Sleep Education
  citation: American Academy of Sleep Medicine. Sleep and Caffeine | Benefits and Risks. Sleep Education. Accessed April 26, 2026. https://sleepeducation.org/sleep-caffeine.
  url: https://sleepeducation.org/sleep-caffeine
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: e76e865bcd4f8e0592857b6ca4c9e770d53808c2cc4056e48d140281e8729228
    url: https://sleepeducation.org/sleep-caffeine
  canonicalUrl: https://sleepeducation.org/sleep-caffeine
researchEvidence:
  designKind: guideline
  designLabel: Professional sleep education web page
  populationLabel: General consumer audience.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: aasm-sleep-and-caffeine-2026-04-26-general-consumer-audience
  notes:
  - 'Intervention or exposure: Public caffeine-and-sleep education, including discussion of caffeine before bedtime.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Sleep time and sleep quality in general guidance.'
  - 'Effect or direction: Page references a study where caffeine 6 hours before bedtime reduced total sleep time by about 1 hour.'
  - 'Safety notes: General risk framing only.'
  - 'Limitations: Web page; source page could not be opened directly in one retrieval attempt but search snippets were accessible.'
  - 'Population mismatch: General audience, not protocol participants.'
  - 'Directness to target protocol: External guidance context only.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It shows how professional sleep education translates primary trial evidence into practical cutoff advice.
potentialMurphEndpoints:
- Total sleep time
- Sleep onset
- Caffeine timing
protocolTakeaway: Use for context and traceability to primary 6-hour timing evidence, not as direct efficacy evidence.
murphTakeaway: A professional public page supports the rationale for avoiding late caffeine but should not replace primary citations.
studyDesign: other
modality: professional-consumer-guidance
claimUse: context-only
sourceFindings:
- findingId: finding:aasm-sleep-and-caffeine-2026-04-26-public-six-hour-guidance
  sourceKey: source_artifact:aasm-sleep-and-caffeine-2026-04-26
  extractedFromArtifactId: art_aasm_sleep_and_caffeine_2026_04_26_html
  findingKind: context
  population: General consumer audience.
  exposure: AASM Sleep Education caffeine-and-sleep advice.
  outcome: Public translation of late-caffeine evidence.
  summary: The AASM Sleep Education page links caffeine timing advice to a study reporting reduced total sleep time when caffeine was consumed 6 hours before bedtime.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** The AASM Sleep Education page links caffeine timing advice to a study reporting reduced total sleep time when caffeine was consumed 6 hours before bedtime.

**Why it matters:** It shows how professional sleep education translates primary trial evidence into practical cutoff advice.

**Potential experiment signals:** Total sleep time; Sleep onset; Caffeine timing.

**Protocol takeaway:** Use for context and traceability to primary 6-hour timing evidence, not as direct efficacy evidence.

**Claim use:** `context-only`.
