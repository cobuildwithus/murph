---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1002-sici-1099-1077-199605-11-3-185-aid-hup786-3.0.co-2-m
slug: sources/caffeine-timing/doi-10.1002-sici-1099-1077-199605-11-3-185-aid-hup786-3.0.co-2-m
title: 'Caffeine-induced sleep disruption: effects on waking the following day and its reversal with an hypnotic'
summary: Older controlled caffeine-sleep-disruption model examining sleep disruption, waking the following day, and a hypnotic reversal condition; useful as direct but paywalled boundary evidence.
status: draft
quality: usable
aliases:
- 'Caffeine-induced sleep disruption: effects on waking the following day and its reversal with an hypnotic'
- doi:10.1002/(sici)1099-1077(199605)11:3<185::aid-hup786>3.0.co;2-m
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: journal_article
  title: 'Caffeine-induced sleep disruption: effects on waking the following day and its reversal with an hypnotic'
  authors: Alford C, Bhatti J, Leigh T, Jamieson A, Hindmarch I
  year: 1996
  journal: 'Human Psychopharmacology: Clinical and Experimental'
  citation: 'Alford C, Bhatti J, Leigh T, Jamieson A, Hindmarch I. Caffeine-induced sleep disruption: effects on waking the following day and its reversal with an hypnotic. Hum Psychopharmacol Clin Exp. 1996;11(3):185-198. doi:10.1002/(SICI)1099-1077(199605)11:3<185::AID-HUP786>3.0.CO;2-M.'
  url: https://doi.org/10.1002/(SICI)1099-1077(199605)11:3%3C185::AID-HUP786%3E3.0.CO;2-M
  doi: 10.1002/(sici)1099-1077(199605)11:3<185::aid-hup786>3.0.co;2-m
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1002/(sici)1099-1077(199605)11:3<185::aid-hup786>3.0.co;2-m
    titleHash: 2776361cd5983187d393e396ffdddff4cc863b01ccefea4a2c7a65b3021c8ac2
    url: https://doi.org/10.1002/(SICI)1099-1077(199605)11:3%3C185::AID-HUP786%3E3.0.CO;2-M
  canonicalUrl: https://doi.org/10.1002/(SICI)1099-1077(199605)11:3%3C185::AID-HUP786%3E3.0.CO;2-M
researchEvidence:
  designKind: crossover_trial
  designLabel: Controlled crossover caffeine sleep-disruption model
  populationLabel: Healthy adult volunteers; exact sample size not extracted from accessible metadata
  durationLabel: Acute overnight caffeine-disruption model with next-day waking assessment
  aggregateRole: primary
  cohortKey: doi-10.1002-sici-1099-1077-199605-11-3-185-aid-hup786-3.0.co-2-m
  notes:
  - Participant count was not asserted because it was not verified in accessible source text during this batch extraction.
  - Some details require full-text verification before use in precise protocol claims.
evidenceBucket: direct_protocol_and_dose_timing
whyItMatters: Anchors the idea that caffeine-disrupted sleep can carry next-day consequences, but details should remain cautious because extraction was limited by paywalled access.
potentialMurphEndpoints:
- sleep onset latency
- sleep efficiency
- next-day alertness or performance
- subjective sleep quality
protocolTakeaway: Use as older direct support that caffeine-related sleep disruption can matter the next day; do not use for exact dose or curfew thresholds without full-text verification.
murphTakeaway: A participant who reports next-day grogginess after late caffeine may have a plausible source-owned rationale for testing a caffeine curfew, but this source alone should not set the 8-hour rule.
studyDesign: Controlled crossover trial
modality: caffeine-induced sleep disruption and next-day waking assessment
claimUse: supports-protocol
sourceFindings:
- findingId: finding:doi-hup786-caffeine-sleep-disruption-next-day
  sourceKey: source_artifact:doi-10.1002-sici-1099-1077-199605-11-3-185-aid-hup786-3.0.co-2-m
  extractedFromArtifactId: art_doi_10_1002_sici_1099_1077_199605_11_3_185_aid_hup786_3_0_co_2_m_abstract
  findingKind: intervention_result
  population: Healthy adult volunteers; exact sample size not extracted from accessible metadata
  exposure: Caffeine-induced sleep disruption with a hypnotic reversal arm
  outcome: Sleep disruption and next-day waking outcomes
  summary: The controlled model linked caffeine-induced sleep disruption with next-day waking consequences, but abstract-level extraction did not verify exact dose, sample size, or effect sizes.
  evidenceUse:
  - efficacy
  - adjacent_variant
murphV1Priority: Medium
pdfRightsStatus: paywalled
---

This source is included for **direct_protocol_and_dose_timing**.

**Findings:** The controlled model linked caffeine-induced sleep disruption with next-day waking consequences, but abstract-level extraction did not verify exact dose, sample size, or effect sizes.

**Why it matters:** Anchors the idea that caffeine-disrupted sleep can carry next-day consequences, but details should remain cautious because extraction was limited by paywalled access.

**Potential experiment signals:** sleep onset latency, sleep efficiency, next-day alertness or performance, subjective sleep quality

**Protocol takeaway:** Use as older direct support that caffeine-related sleep disruption can matter the next day; do not use for exact dose or curfew thresholds without full-text verification.

**Claim use:** `supports-protocol`.
