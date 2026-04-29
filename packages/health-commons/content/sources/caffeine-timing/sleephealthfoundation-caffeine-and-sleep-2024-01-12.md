---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sleephealthfoundation-caffeine-and-sleep-2024-01-12
slug: sources/caffeine-timing/sleephealthfoundation-caffeine-and-sleep-2024-01-12
title: Caffeine and Sleep
summary: A Sleep Health Foundation fact sheet gives public caffeine-and-sleep advice, including avoiding caffeine several hours before sleep; it is external guidance rather than primary evidence.
status: draft
quality: usable
aliases:
- Caffeine and Sleep
- source_artifact:sleephealthfoundation-caffeine-and-sleep-2024-01-12
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: Caffeine and Sleep
  authors: Sleep Health Foundation
  year: 2024
  journal: Sleep Health Foundation
  citation: Sleep Health Foundation. Caffeine and Sleep. January 12, 2024. https://www.sleephealthfoundation.org.au/sleep-topics/caffeine-and-sleep.
  url: https://www.sleephealthfoundation.org.au/sleep-topics/caffeine-and-sleep
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: d64efafe2e2a1f2f23a732666db5af8700d940cffb149250ab154ccc2bac63b9
    url: https://www.sleephealthfoundation.org.au/sleep-topics/caffeine-and-sleep
  canonicalUrl: https://www.sleephealthfoundation.org.au/sleep-topics/caffeine-and-sleep
researchEvidence:
  designKind: guideline
  designLabel: Consumer sleep fact sheet
  populationLabel: General consumer audience.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: sleephealthfoundation-caffeine-and-sleep-2024-01-12-general-consumer-audience
  notes:
  - 'Intervention or exposure: Public advice to limit caffeine and avoid it before sleep.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Falling asleep and lighter sleep.'
  - 'Effect or direction: External guidance; no original effect estimate.'
  - 'Safety notes: General stimulant/sleep caution; no adverse-event dataset.'
  - 'Limitations: The originally supplied URL appears to have been superseded by a broader current Sleep Health Foundation page during extraction.'
  - 'Population mismatch: General audience, not a 14-day curfew intervention.'
  - 'Directness to target protocol: External protocol-claim context only.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It provides external wording for public caffeine curfew advice and alias ranges such as after-lunch or several-hour buffers.
potentialMurphEndpoints:
- Sleep onset
- Sleep quality
- Caffeine timing adherence
protocolTakeaway: Use for external-claim boundary only; do not cite it as efficacy evidence.
murphTakeaway: Public sleep-health advice commonly discourages late caffeine, but primary trial evidence should carry claims.
studyDesign: other
modality: consumer-guidance
claimUse: context-only
sourceFindings:
- findingId: finding:sleephealthfoundation-caffeine-and-sleep-2024-01-12-public-curfew-guidance
  sourceKey: source_artifact:sleephealthfoundation-caffeine-and-sleep-2024-01-12
  extractedFromArtifactId: art_sleephealthfoundation_caffeine_and_sleep_2024_01_12_html
  findingKind: context
  population: General consumer audience.
  exposure: Sleep Health Foundation caffeine and sleep advice.
  outcome: Public recommendation to limit late caffeine before sleep.
  summary: The Sleep Health Foundation fact sheet advises limiting caffeine before sleep, but it is a public guidance source and not primary intervention evidence.
  evidenceUse:
  - context
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** The Sleep Health Foundation fact sheet advises limiting caffeine before sleep, but it is a public guidance source and not primary intervention evidence.

**Why it matters:** It provides external wording for public caffeine curfew advice and alias ranges such as after-lunch or several-hour buffers.

**Potential experiment signals:** Sleep onset; Sleep quality; Caffeine timing adherence.

**Protocol takeaway:** Use for external-claim boundary only; do not cite it as efficacy evidence.

**Claim use:** `context-only`.
