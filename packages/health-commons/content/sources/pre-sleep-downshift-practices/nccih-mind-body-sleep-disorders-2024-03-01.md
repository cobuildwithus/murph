---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nccih-mind-body-sleep-disorders-2024-03-01
slug: sources/pre-sleep-downshift-practices/nccih-mind-body-sleep-disorders-2024-03-01
title: Psychological and Physical Approaches for Sleep Disorders
summary: "NCCIH Clinical Digest summarizing evidence and guideline boundaries for mind-body approaches to sleep disorders, including mindfulness."
status: draft
quality: usable
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
  title: Psychological and Physical Approaches for Sleep Disorders
  authors: National Center for Complementary and Integrative Health
  year: 2024
  journal: NCCIH Clinical Digest
  citation: National Center for Complementary and Integrative Health. Psychological and Physical Approaches for Sleep Disorders. NCCIH Clinical Digest. March 2024.
  url: https://www.nccih.nih.gov/health/providers/digest/psychological-and-physical-approaches-for-sleep-disorders
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 9ae506873c7569c7a107e1f0001b02733b4e0a48b172f49f8a5c5bd1bd77e282
    url: https://www.nccih.nih.gov/health/providers/digest/psychological-and-physical-approaches-for-sleep-disorders
  canonicalUrl: https://www.nccih.nih.gov/health/providers/digest/psychological-and-physical-approaches-for-sleep-disorders
researchEvidence:
  designKind: guideline
  designLabel: Government clinical digest and guideline summary
  populationLabel: "People with sleep disorders, especially chronic insomnia, as addressed in summarized guidelines."
  durationLabel: Not applicable.
  aggregateRole: primary
  cohortKey: cohort:nccih-provider-digest-sleep-disorders
  notes:
    - "Original extracted designKind: guideline_summary."
evidenceBucket: digital_app_guided_variants
whyItMatters: Provides an institutional boundary against overclaiming mindfulness-by-itself for insomnia despite related mind-body evidence.
protocolTakeaway: "Use as context-only guideline boundary: mindfulness by itself lacks enough guideline-grade evidence for an insomnia recommendation."
murphTakeaway: Helps keep Murph claims conservative when app or guided mindfulness studies are adjacent but not direct silent bedtime evidence.
studyDesign: Government evidence digest
modality: external guideline/evidence summary
claimUse: context-only
sourceFindings:
  -
    findingId: finding:nccih-mind-body-sleep-disorders-2024-03-01-guideline-mindfulness-boundary
    sourceKey: source_artifact:nccih-mind-body-sleep-disorders-2024-03-01
    extractedFromArtifactId: art_batch006_nccih_mind_body_sleep_disorders_2024_03_01
    findingKind: context
    population: Adults with chronic insomnia or sleep disorders addressed in clinical-practice guideline summaries.
    exposure: Meditation and mindfulness practices considered as mind-body approaches for sleep disorders.
    outcome: Guideline stance and evidence sufficiency for mindfulness by itself in insomnia.
    summary: The NCCIH provider digest states that VA/DoD found evidence insufficient to know whether mindfulness meditation helps insomnia and that the AASM 2021 guideline found insufficient evidence to make recommendations for mindfulness by itself.
    evidenceUse:
      - context
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **digital_app_guided_variants**.

**Findings:**
- `finding:nccih-mind-body-sleep-disorders-2024-03-01-guideline-mindfulness-boundary` — The NCCIH provider digest states that VA/DoD found evidence insufficient to know whether mindfulness meditation helps insomnia and that the AASM 2021 guideline found insufficient evidence to make recommendations for mindfulness by itself.

**Why it matters:** Provides an institutional boundary against overclaiming mindfulness-by-itself for insomnia despite related mind-body evidence.

**Potential experiment signals:** None extracted as source-specific protocol endpoints; use as context/safety boundary.

**Protocol takeaway:** Use as context-only guideline boundary: mindfulness by itself lacks enough guideline-grade evidence for an insomnia recommendation.

**Claim use:** `context-only`.
