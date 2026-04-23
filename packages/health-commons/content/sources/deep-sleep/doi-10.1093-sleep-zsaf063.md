---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1093-sleep-zsaf063
slug: sources/deep-sleep/doi-10.1093-sleep-zsaf063
title: "Is it time to revisit the scoring of slow wave (N3) sleep?"
summary: Sleep article used to anchor the EEG definition of N3 / slow-wave sleep and to keep the biomarker page explicit about scoring-threshold limitations.
status: draft
quality: usable
categories:
  - deep-sleep
  - sleep-stage-scoring
  - eeg
relations:
  -
    type: measures
    target: biomarker:deep-sleep-minutes
source:
  kind: journal_article
  title: "Is it time to revisit the scoring of slow wave (N3) sleep?"
  authors: Davidson S, et al
  year: 2025
  journal: Sleep
  citation: "Davidson S, et al. Is it time to revisit the scoring of slow wave (N3) sleep? Sleep. 2025;48(10):zsaf063. doi:10.1093/sleep/zsaf063."
  doi: 10.1093/sleep/zsaf063
  url: https://academic.oup.com/sleep/article/48/10/zsaf063/8074201
researchEvidence:
  designKind: other
  designLabel: Sleep-stage scoring methods paper
  populationLabel: Sleep Heart Health Study EEG records and current AASM scoring context
  aggregateRole: context
  notes:
    - Used for definition and measurement-boundary context, not as evidence that consumer wearables accurately measure N3.
evidenceBucket: N3 definition and scoring boundary
whyItMatters: Defines why deep sleep minutes are not directly measured by wrist or ring devices and why even EEG-scored N3 is a thresholded simplification.
potentialMurphEndpoints:
  - N3 sleep minutes
  - slow-wave sleep duration
  - sleep-stage confidence
murphTakeaway: Keep the page clear that the clinical reference is EEG-scored N3 and that consumer wearables infer stage labels indirectly.
---

This source anchors the **measurement definition** for the deep-sleep biomarker. It explains that current AASM-style rules define slow waves by EEG frequency and amplitude criteria and label an epoch as N3 when enough of the epoch contains slow waves.

**Murph implication:** Wearable deep sleep should be displayed as an estimated sleep-stage trend. It should not be presented as direct slow-wave activity, direct sleep depth, or direct glymphatic clearance.
