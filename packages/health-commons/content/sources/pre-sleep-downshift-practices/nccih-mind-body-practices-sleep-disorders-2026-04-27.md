---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nccih-mind-body-practices-sleep-disorders-2026-04-27
slug: sources/pre-sleep-downshift-practices/nccih-mind-body-practices-sleep-disorders-2026-04-27
title: "Mind and Body Practices for Sleep Disorders: What the Science Says"
summary: "NCCIH Clinical Digest summarizing guideline and evidence context for mind-body practices used for sleep disorders, including CBT-I, relaxation therapy, mindfulness, yoga, and tai chi; useful as background context only."
status: draft
quality: usable
aliases:
  - "NCCIH Clinical Digest: Mind and Body Practices for Sleep Disorders"
  - Mind and Body Practices for Sleep Disorders
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
  kind: web_page
  title: "Mind and Body Practices for Sleep Disorders: What the Science Says"
  authors: National Center for Complementary and Integrative Health
  year: 2022
  journal: NCCIH Clinical Digest
  citation: "National Center for Complementary and Integrative Health. Mind and Body Practices for Sleep Disorders: What the Science Says. NCCIH Clinical Digest. December 2022."
  url: https://www.nccih.nih.gov/health/providers/digest/mind-and-body-practices-for-sleep-disorders-science
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 70eb7942b547691666d4bc9c4d6cbcac84b2f3a278da66ddd11378598741c690
    url: https://www.nccih.nih.gov/health/providers/digest/mind-and-body-practices-for-sleep-disorders-science
  canonicalUrl: https://www.nccih.nih.gov/health/providers/digest/mind-and-body-practices-for-sleep-disorders-science
researchEvidence:
  designKind: guideline
  designLabel: Government clinical digest and guideline/evidence summary
  populationLabel: Health professionals considering mind-body practices for adults with sleep disorders or chronic insomnia.
  durationLabel: Not applicable; source summarizes guidelines and selected trials/reviews.
  aggregateRole: context
  cohortKey: cohort:nccih-mind-body-practices-sleep-disorders-2022-digest
  notes:
    - No participant count for the source page itself; participant counts are reported only for cited secondary summaries and trials.
evidenceBucket: background_context
directness: background
whyItMatters: This institutional digest anchors the boundary between clinical guideline-supported insomnia treatments and indirect meditation or mindfulness evidence.
potentialMurphEndpoints:
  - outcome:insomnia-symptoms
  - outcome:subjective-sleep-quality
  - biomarker:sleep-onset-latency
  - biomarker:sleep-efficiency
protocolTakeaway: "Use as background and guideline context only: NCCIH describes mindfulness evidence as limited and notes that AASM did not make a mindfulness recommendation because too few eligible studies met criteria."
murphTakeaway: "For Murph, this source helps prevent overclaiming: silent pre-sleep meditation can be discussed as an adjacent low-risk downshift practice, not as a guideline-equivalent replacement for CBT-I."
studyDesign: "Government clinical digest summarizing clinical guidelines, systematic reviews, and selected trials."
modality: "Mind-body practices for sleep disorders, including CBT-I, relaxation therapy, mindfulness meditation, yoga, and tai chi."
claimUse: context-only
sourceFindings:
  -
    findingId: finding:nccih-mind-body-practices-sleep-disorders-guideline-boundary
    sourceKey: source_artifact:nccih-mind-body-practices-sleep-disorders-2026-04-27
    extractedFromArtifactId: art-batch011-nccih-mind-body-practices-sleep-disorders-2026-04-27
    findingKind: context
    population: Adults with chronic insomnia disorder considered in clinical guidelines summarized by NCCIH.
    exposure: "Behavioral and psychological sleep interventions, including CBT-I, relaxation therapy, mindfulness, biofeedback, and related mind-body approaches."
    outcome: Clinical guideline stance for insomnia treatment options.
    summary: "NCCIH summarizes that AASM recommends multicomponent CBT-I strongly for chronic insomnia disorder and conditionally recommends relaxation therapy as a single-component therapy; the same guideline made no recommendations for mindfulness, cognitive therapy, paradoxical intention, biofeedback, or intensive sleep retraining because fewer than three eligible studies met criteria. NCCIH also summarizes ACP guidance recommending CBT-I as initial treatment."
    evidenceUse:
      - context
  -
    findingId: finding:nccih-mind-body-practices-sleep-disorders-mindfulness-sleep-quality-summary
    sourceKey: source_artifact:nccih-mind-body-practices-sleep-disorders-2026-04-27
    extractedFromArtifactId: art-batch011-nccih-mind-body-practices-sleep-disorders-2026-04-27
    findingKind: context
    population: Mixed adult populations in mindfulness meditation studies and adults aged 75 years and older with chronic insomnia in one cited randomized trial.
    exposure: Mindfulness meditation practices and mindfulness-based stress reduction.
    outcome: Sleep quality and insomnia symptoms.
    summary: "NCCIH characterizes the meditation and mindfulness evidence as limited. It reports that a 2019 systematic review and meta-analysis of 18 studies with 1,654 participants found mindfulness meditation improved sleep quality more than education-based controls but did not differ from evidence-based treatments such as CBT or exercise; it also notes a 2015 randomized trial of 60 adults aged 75 years and older suggesting MBSR could be useful for chronic insomnia in that age group."
    evidenceUse:
      - context
      - adjacent_variant
  -
    findingId: finding:nccih-mind-body-practices-sleep-disorders-meditation-safety-summary
    sourceKey: source_artifact:nccih-mind-body-practices-sleep-disorders-2026-04-27
    extractedFromArtifactId: art-batch011-nccih-mind-body-practices-sleep-disorders-2026-04-27
    findingKind: safety
    population: People considering meditation or mindfulness practices for sleep problems.
    exposure: Meditation and mindfulness practices.
    outcome: High-level safety statement.
    summary: "NCCIH states that meditation and mindfulness practices usually are considered to have few risks, but the digest is a high-level summary and does not provide a trial-level adverse-event table for pre-sleep silent meditation."
    evidenceUse:
      - safety
      - context
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **background_context**.

**Findings:**

- `finding:nccih-mind-body-practices-sleep-disorders-guideline-boundary` — NCCIH summarizes that AASM recommends multicomponent CBT-I strongly for chronic insomnia disorder and conditionally recommends relaxation therapy as a single-component therapy; the same guideline made no recommendations for mindfulness, cognitive therapy, paradoxical intention, biofeedback, or intensive sleep retraining because fewer than three eligible studies met criteria. NCCIH also summarizes ACP guidance recommending CBT-I as initial treatment.
- `finding:nccih-mind-body-practices-sleep-disorders-mindfulness-sleep-quality-summary` — NCCIH characterizes the meditation and mindfulness evidence as limited. It reports that a 2019 systematic review and meta-analysis of 18 studies with 1,654 participants found mindfulness meditation improved sleep quality more than education-based controls but did not differ from evidence-based treatments such as CBT or exercise; it also notes a 2015 randomized trial of 60 adults aged 75 years and older suggesting MBSR could be useful for chronic insomnia in that age group.
- `finding:nccih-mind-body-practices-sleep-disorders-meditation-safety-summary` — NCCIH states that meditation and mindfulness practices usually are considered to have few risks, but the digest is a high-level summary and does not provide a trial-level adverse-event table for pre-sleep silent meditation.

**Why it matters:** This institutional digest anchors the boundary between clinical guideline-supported insomnia treatments and indirect meditation or mindfulness evidence.

**Potential experiment signals:**

- outcome:insomnia-symptoms
- outcome:subjective-sleep-quality
- biomarker:sleep-onset-latency
- biomarker:sleep-efficiency

**Protocol takeaway:** Use as background and guideline context only: NCCIH describes mindfulness evidence as limited and notes that AASM did not make a mindfulness recommendation because too few eligible studies met criteria.

**Claim use:** `context-only`.
