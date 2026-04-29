---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:health-10-3-2-1-0-sleep-rule-2026-03-29
slug: sources/caffeine-timing/health-10-3-2-1-0-sleep-rule-2026-03-29
title: Follow the 10-3-2-1-0 Sleep Rule for a Better Night’s Rest
summary: A popular Health.com article defines the 10-3-2-1-0 sleep rule, including stopping caffeine 10 hours before bed; it is external protocol-claim context only.
status: draft
quality: usable
aliases:
- Follow the 10-3-2-1-0 Sleep Rule for a Better Night’s Rest
- source_artifact:health-10-3-2-1-0-sleep-rule-2026-03-29
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: web_page
  title: Follow the 10-3-2-1-0 Sleep Rule for a Better Night’s Rest
  authors: Health.com
  year: 2026
  journal: Health.com
  citation: Health.com. Follow the 10-3-2-1-0 Sleep Rule for a Better Night’s Rest. March 29, 2026. https://www.health.com/10-3-2-1-0-sleep-rule-11700923.
  url: https://www.health.com/10-3-2-1-0-sleep-rule-11700923
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 1b9e83f6392f2e403c96366a55dfb747590d57c002973b384eadd48d8ecabe94
    url: https://www.health.com/10-3-2-1-0-sleep-rule-11700923
  canonicalUrl: https://www.health.com/10-3-2-1-0-sleep-rule-11700923
researchEvidence:
  designKind: guideline
  designLabel: Popular sleep-rule web article
  populationLabel: General consumer audience.
  durationLabel: No intervention follow-up.
  aggregateRole: context
  cohortKey: health-10-3-2-1-0-sleep-rule-2026-03-29-general-consumer-audience
  notes:
  - 'Intervention or exposure: Popular 10-3-2-1-0 rule including no caffeine 10 hours before bed.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Better night’s rest and sleep routine behaviors.'
  - 'Effect or direction: External protocol claim; no primary effect estimate.'
  - 'Safety notes: General consumer advice only.'
  - 'Limitations: Popular media article; not a trial of the bundled rule or caffeine cutoff.'
  - 'Population mismatch: General audience.'
  - 'Directness to target protocol: External protocol-claim context only.'
evidenceBucket: external_protocol_claims_and_guidelines
whyItMatters: It documents a popular 10-hour caffeine cutoff alias that may be conflated with the target 8-hour or 10-11am curfew.
potentialMurphEndpoints:
- Caffeine timing adherence
- Sleep routine adherence
- Sleep quality
protocolTakeaway: Use for claim-boundary auditing only; the bundled 10-3-2-1-0 rule is not direct evidence for caffeine curfew efficacy.
murphTakeaway: Popular rules can be useful behavior prompts but should not be overstated as tested protocols.
studyDesign: other
modality: popular-protocol-claim
claimUse: context-only
sourceFindings:
- findingId: finding:health-10-3-2-1-0-sleep-rule-2026-03-29-ten-hour-caffeine-alias
  sourceKey: source_artifact:health-10-3-2-1-0-sleep-rule-2026-03-29
  extractedFromArtifactId: art_health_10_3_2_1_0_sleep_rule_2026_03_29_html
  findingKind: context
  population: General consumer audience.
  exposure: 10-3-2-1-0 sleep rule public advice.
  outcome: Popular 10-hour caffeine cutoff claim.
  summary: Health.com presents the 10-3-2-1-0 rule with a 10-hour pre-bed caffeine cutoff, but the article is not primary evidence that the bundled rule improves sleep.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **external_protocol_claims_and_guidelines**.

**Findings:** Health.com presents the 10-3-2-1-0 rule with a 10-hour pre-bed caffeine cutoff, but the article is not primary evidence that the bundled rule improves sleep.

**Why it matters:** It documents a popular 10-hour caffeine cutoff alias that may be conflated with the target 8-hour or 10-11am curfew.

**Potential experiment signals:** Caffeine timing adherence; Sleep routine adherence; Sleep quality.

**Protocol takeaway:** Use for claim-boundary auditing only; the bundled 10-3-2-1-0 rule is not direct evidence for caffeine curfew efficacy.

**Claim use:** `context-only`.
