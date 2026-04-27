---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.2147-nss.s578770
slug: sources/pre-sleep-downshift-practices/doi-10.2147-nss.s578770
title: "The efficacy of therapist-guided, internet-delivered mindfulness-based cognitive therapy for chronic insomnia disorder: a randomized controlled trial"
summary: Recent chronic-insomnia RCT of therapist-guided online MBCT-I; relevant to digital guided mindfulness boundaries but not direct silent bedtime meditation evidence.
status: draft
quality: usable
aliases:
  - Internet-delivered mindfulness-based cognitive therapy for chronic insomnia disorder
categories:
  - pre-sleep-downshift-practices
relations:
  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: journal_article
  title: "The efficacy of therapist-guided, internet-delivered mindfulness-based cognitive therapy for chronic insomnia disorder: a randomized controlled trial"
  authors: Zeng Z; Jiang J; Xie K; Luo N; Guan X; Zhu C; Lu Z; Huang L
  year: 2026
  journal: Nature and Science of Sleep
  citation: "Zeng Z, Jiang J, Xie K, Luo N, Guan X, Zhu C, Lu Z, Huang L. The efficacy of therapist-guided, internet-delivered mindfulness-based cognitive therapy for chronic insomnia disorder: a randomized controlled trial. Nature and Science of Sleep. 2026;18:578770. doi:10.2147/NSS.S578770."
  doi: 10.2147/nss.s578770
  url: https://www.dovepress.com/the-efficacy-of-therapist-guided-internet-delivered-mindfulness-based--peer-reviewed-fulltext-article-NSS
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.2147/nss.s578770
    titleHash: c8e56b01cb197c6d727fa3413ff6ea8c28bea2a82f33461dd38a587fbdf93b41
    url: https://www.dovepress.com/the-efficacy-of-therapist-guided-internet-delivered-mindfulness-based--peer-reviewed-fulltext-article-NSS
  canonicalUrl: https://www.dovepress.com/the-efficacy-of-therapist-guided-internet-delivered-mindfulness-based--peer-reviewed-fulltext-article-NSS
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Open-label randomized controlled trial
  participantCount: 82
  participantCountKind: reported
  populationLabel: Adults aged 18-65 with chronic insomnia disorder.
  durationLabel: 8-week intervention with primary endpoint at week 8 and follow-up at week 20.
  aggregateRole: primary
  cohortKey: cohort:doi-10.2147-nss.s578770-chronic-insomnia-rct
  notes:
    - "Original extracted designKind: rct."
evidenceBucket: digital_app_guided_variants
whyItMatters: "High-detail evidence that a guided online mindfulness-CBT package can improve clinical insomnia outcomes, while also showing why component attribution to silent meditation is not justified."
potentialMurphEndpoints:
  - biomarker:sleep-efficiency
  - biomarker:sleep-onset-latency
protocolTakeaway: "Adjacent clinical-supervised evidence only: the intervention combined therapist guidance, group sessions, homework, mindfulness, and CBT-I elements rather than a brief silent pre-bed practice."
murphTakeaway: Useful comparator for “guided online therapy package” claims and for safety context; do not frame as proof that silent meditation before bed works by itself.
studyDesign: Randomized controlled trial
modality: therapist-guided internet-delivered MBCT-I
claimUse: context-only
sourceFindings:
  -
    findingId: finding:doi-10.2147-nss.s578770-imbct-i-insomnia-improvement
    sourceKey: source_artifact:doi-10.2147-nss.s578770
    extractedFromArtifactId: art_batch006_doi_10_2147_nss_s578770
    findingKind: intervention_result
    population: Adults aged 18-65 with chronic insomnia disorder and ISI greater than 14; randomized n=82.
    exposure: "Eight-week therapist-guided internet-delivered mindfulness-based cognitive therapy for insomnia, including mindfulness practices and CBT-I components, versus one-session sleep hygiene education."
    outcome: Insomnia severity and sleep diary/polysomnography-related outcomes through week 8 and week 20 follow-up.
    summary: "The iMBCT-I arm improved ISI more than sleep hygiene at week 8 (mean difference 4.00, 95% CI 2.22 to 5.78; p<0.001; Cohen d=0.99) with higher remission odds (OR 6.21, 95% CI 2.24 to 17.23) and improvements in PSQI, SOL, WASO, sleep efficiency, REM duration, depression, and quality of life."
    evidenceUse:
      - adjacent_variant
      - efficacy
  -
    findingId: finding:doi-10.2147-nss.s578770-no-serious-adverse-events
    sourceKey: source_artifact:doi-10.2147-nss.s578770
    extractedFromArtifactId: art_batch006_doi_10_2147_nss_s578770
    findingKind: safety
    population: Adults with chronic insomnia disorder enrolled in the online therapist-guided trial.
    exposure: Therapist-guided internet-delivered MBCT-I.
    outcome: Serious adverse events during the trial.
    summary: "The article reported no serious adverse events during the trial, while routine safety monitoring was included."
    evidenceUse:
      - adjacent_variant
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **digital_app_guided_variants**.

**Findings:**
- `finding:doi-10.2147-nss.s578770-imbct-i-insomnia-improvement` — The iMBCT-I arm improved ISI more than sleep hygiene at week 8 (mean difference 4.00, 95% CI 2.22 to 5.78; p<0.001; Cohen d=0.99) with higher remission odds (OR 6.21, 95% CI 2.24 to 17.23) and improvements in PSQI, SOL, WASO, sleep efficiency, REM duration, depression, and quality of life.
- `finding:doi-10.2147-nss.s578770-no-serious-adverse-events` — The article reported no serious adverse events during the trial, while routine safety monitoring was included.

**Why it matters:** High-detail evidence that a guided online mindfulness-CBT package can improve clinical insomnia outcomes, while also showing why component attribution to silent meditation is not justified.

**Potential experiment signals:** `biomarker:sleep-efficiency`, `biomarker:sleep-onset-latency`.

**Protocol takeaway:** Adjacent clinical-supervised evidence only: the intervention combined therapist guidance, group sessions, homework, mindfulness, and CBT-I elements rather than a brief silent pre-bed practice.

**Claim use:** `context-only`.
