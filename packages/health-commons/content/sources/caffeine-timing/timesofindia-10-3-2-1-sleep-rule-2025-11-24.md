---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:timesofindia-10-3-2-1-sleep-rule-2025-11-24
slug: sources/caffeine-timing/timesofindia-10-3-2-1-sleep-rule-2025-11-24
title: Can the 10-3-2-1 rule improve your sleep? Here's what science says
summary: A popular media claim-audit article describes the 10-3-2-1 sleep rule and flags that the complete bundled rule lacks direct comprehensive testing.
status: draft
quality: usable
aliases:
- Can the 10-3-2-1 rule improve your sleep? Here's what science says
- source_artifact:timesofindia-10-3-2-1-sleep-rule-2025-11-24
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: Can the 10-3-2-1 rule improve your sleep? Here's what science says
  authors: The Times of India
  year: 2025
  journal: The Times of India
  citation: The Times of India. Can the 10-3-2-1 rule improve your sleep? Here’s what science says. November 24, 2025. https://timesofindia.indiatimes.com/life-style/health-fitness/health-news/can-the-10-3-2-1-rule-improve-your-sleep-heres-what-science-says/articleshow/125577774.cms.
  url: https://timesofindia.indiatimes.com/life-style/health-fitness/health-news/can-the-10-3-2-1-rule-improve-your-sleep-heres-what-science-says/articleshow/125577774.cms
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 51b4faa4a4796b1645f364bd05b498bd92e3cbec199b7acecaa51be28b99b9a3
    url: https://timesofindia.indiatimes.com/life-style/health-fitness/health-news/can-the-10-3-2-1-rule-improve-your-sleep-heres-what-science-says/articleshow/125577774.cms
  canonicalUrl: https://timesofindia.indiatimes.com/life-style/health-fitness/health-news/can-the-10-3-2-1-rule-improve-your-sleep-heres-what-science-says/articleshow/125577774.cms
researchEvidence:
  designKind: other
  designLabel: Popular media sleep-rule article
  populationLabel: General consumer audience.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: timesofindia-10-3-2-1-sleep-rule-2025-11-24-general-consumer-audience
  notes:
  - 'Intervention or exposure: 10-3-2-1 sleep rule, including avoiding caffeine 10 hours before bed.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Claimed sleep improvement and sleep routine behaviors.'
  - 'Effect or direction: Popular media context; no original effect estimate.'
  - 'Safety notes: General advice only.'
  - 'Limitations: Exact supplied URL was not directly opened during extraction; accessible search results for the title emphasized lack of comprehensive direct testing of the full rule.'
  - 'Population mismatch: General audience.'
  - 'Directness to target protocol: External claim-boundary context only.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It helps separate popular bundled sleep-rule claims from primary evidence for individual components such as caffeine timing.
potentialMurphEndpoints:
- Caffeine timing adherence
- Sleep routine adherence
- Sleep quality
protocolTakeaway: Use only for external-protocol claim auditing; do not use it as evidence that a 10-hour or 8-hour caffeine curfew works.
murphTakeaway: Popular rules often combine plausible components, but the bundle should be treated as untested unless direct trials exist.
studyDesign: other
modality: popular-protocol-claim-audit
claimUse: context-only
sourceFindings:
- findingId: finding:timesofindia-10-3-2-1-sleep-rule-2025-11-24-bundled-rule-boundary
  sourceKey: source_artifact:timesofindia-10-3-2-1-sleep-rule-2025-11-24
  extractedFromArtifactId: art_timesofindia_10_3_2_1_sleep_rule_2025_11_24_html
  findingKind: context
  population: General consumer audience.
  exposure: Popular 10-3-2-1 sleep-rule advice.
  outcome: Claim boundary for bundled sleep-rule efficacy.
  summary: The Times of India article describes the 10-3-2-1 rule, including a 10-hour caffeine component, and is useful only for auditing popular claims rather than establishing efficacy.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** The Times of India article describes the 10-3-2-1 rule, including a 10-hour caffeine component, and is useful only for auditing popular claims rather than establishing efficacy.

**Why it matters:** It helps separate popular bundled sleep-rule claims from primary evidence for individual components such as caffeine timing.

**Potential experiment signals:** Caffeine timing adherence; Sleep routine adherence; Sleep quality.

**Protocol takeaway:** Use only for external-protocol claim auditing; do not use it as evidence that a 10-hour or 8-hour caffeine curfew works.

**Claim use:** `context-only`.
