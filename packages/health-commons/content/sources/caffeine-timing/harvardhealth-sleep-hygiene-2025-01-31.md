---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:harvardhealth-sleep-hygiene-2025-01-31
slug: sources/caffeine-timing/harvardhealth-sleep-hygiene-2025-01-31
title: What is sleep hygiene?
summary: Harvard Health sleep-hygiene advice includes avoiding caffeine after lunch if it keeps a person awake at night; it is public guidance, not primary evidence.
status: draft
quality: usable
aliases:
- What is sleep hygiene?
- source_artifact:harvardhealth-sleep-hygiene-2025-01-31
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: What is sleep hygiene?
  authors: Harvard Health Publishing
  year: 2025
  journal: Harvard Health Publishing
  citation: Harvard Health Publishing. What is sleep hygiene? Updated January 31, 2025. https://www.health.harvard.edu/staying-healthy/what-is-sleep-hygiene.
  url: https://www.health.harvard.edu/staying-healthy/what-is-sleep-hygiene
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 3ba20b080d09808dcc1c87c41b3b78255c6eeea28328ffe5ee56ab1fd65bdf38
    url: https://www.health.harvard.edu/staying-healthy/what-is-sleep-hygiene
  canonicalUrl: https://www.health.harvard.edu/staying-healthy/what-is-sleep-hygiene
researchEvidence:
  designKind: guideline
  designLabel: Consumer health sleep-hygiene guidance
  populationLabel: General consumer audience.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: harvardhealth-sleep-hygiene-2025-01-31-general-consumer-audience
  notes:
  - 'Intervention or exposure: Sleep-hygiene advice including avoiding caffeine after lunch if it keeps the reader awake.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Sleep hygiene and sleep continuity.'
  - 'Effect or direction: External advice only; no original effect estimate.'
  - 'Safety notes: General guidance only.'
  - 'Limitations: Consumer health page; not a controlled trial.'
  - 'Population mismatch: General audience.'
  - 'Directness to target protocol: General guideline/context.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It documents an after-lunch alias for caffeine curfew advice and sleep-diary implementation language.
potentialMurphEndpoints:
- Caffeine timing adherence
- Sleep onset
- Sleep diary
protocolTakeaway: Use as external wording context only; primary trial evidence should support claims.
murphTakeaway: After-lunch cutoff advice can be framed as a practical alias, not a universal evidence-derived threshold.
studyDesign: other
modality: consumer-health-guidance
claimUse: context-only
sourceFindings:
- findingId: finding:harvardhealth-sleep-hygiene-2025-01-31-after-lunch-caffeine-guidance
  sourceKey: source_artifact:harvardhealth-sleep-hygiene-2025-01-31
  extractedFromArtifactId: art_harvardhealth_sleep_hygiene_2025_01_31_html
  findingKind: context
  population: General consumer audience.
  exposure: Harvard Health sleep-hygiene advice.
  outcome: After-lunch caffeine avoidance guidance for people kept awake by caffeine.
  summary: Harvard Health frames avoiding caffeine after lunch as a sleep-hygiene practice for people whose sleep is affected by caffeine.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** Harvard Health frames avoiding caffeine after lunch as a sleep-hygiene practice for people whose sleep is affected by caffeine.

**Why it matters:** It documents an after-lunch alias for caffeine curfew advice and sleep-diary implementation language.

**Potential experiment signals:** Caffeine timing adherence; Sleep onset; Sleep diary.

**Protocol takeaway:** Use as external wording context only; primary trial evidence should support claims.

**Claim use:** `context-only`.
