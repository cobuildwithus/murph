---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.17241-smr.2024.02593
slug: sources/whole-body-photobiomodulation/doi-10.17241-smr.2024.02593
title: Photobiomodulation and Its Therapeutic Potential in Sleep Disturbances
summary: Open-access narrative review on PBM and sleep disturbances summarizing early clinical evidence, mechanism hypotheses, safety boundaries, and the need for standardized protocols.
status: draft
quality: usable
aliases:
  - 10.17241/smr.2024.02593
categories:
  - whole-body-photobiomodulation
relations:

  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: review
  title: Photobiomodulation and Its Therapeutic Potential in Sleep Disturbances
  authors: Jieun Jung, Tae Kim
  year: 2024
  journal: Sleep Medicine Research
  citation: Jung J, Kim T. Photobiomodulation and Its Therapeutic Potential in Sleep Disturbances. Sleep Med Res. 2024;15(4):218-227. doi:10.17241/smr.2024.02593.
  doi: 10.17241/smr.2024.02593
  url: https://www.sleepmedres.org/journal/view.php?doi=10.17241%2Fsmr.2024.02593
researchEvidence:
  designKind: narrative_review
  designLabel: Narrative review of PBM and sleep evidence
  populationLabel: Preclinical and clinical PBM/sleep literature across healthy and disease populations
  durationLabel: Not applicable
  aggregateRole: synthesis
  cohortKey: jung-2024-sleep-review
evidenceBucket: Mechanism and review context
whyItMatters: This review preserves uncertainty, mixed results, and safety caveats while mapping pathways that may matter for sleep-focused PBM experiments.
potentialMurphEndpoints:
  - sleep quality
  - sleep efficiency
  - EEG or qEEG
  - mood
  - adverse events and tolerability
protocolTakeaway: Use as background on mechanism, safety, and protocol heterogeneity; do not treat it as direct proof that whole-body PBM improves sleep.
murphTakeaway: Helpful for hypothesis mapping and things-to-watch sections, especially around dose standardization and safety boundaries.
studyDesign: Narrative review
modality: Photobiomodulation across transcranial, cervical, whole-body, and other delivery modes
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **Mechanism and review context**.

**Findings:** This review argues that PBM may influence sleep architecture, duration, and quality through mitochondrial cytochrome c oxidase activity, ATP and downstream adenosine signaling, nitric oxide pathways, antioxidant effects, anti-inflammatory effects, altered brain activity, and cerebral blood flow changes. It also preserves mixed clinical evidence: one sham-controlled study summarized in the review showed unchanged actigraphy between groups despite better perceived sleep quality, relaxation, and mood in the active group. The review repeatedly states that the clinical literature is still early and heterogeneous and that wavelengths, doses, durations, and delivery methods need standardization. Safety notes include generally favorable transcranial safety signals in neurological settings, but also photosensitivity and phototoxicity boundaries, dosimetry variation by skin color and body composition, placebo effects, and unresolved long-term safety. Population mismatch remains substantial because most summarized studies are not direct whole-body sleep trials.

**Why it matters:** It is a good source for mechanism recall, safety boundaries, and preserving mixed/null context without overclaiming efficacy.

**Potential experiment signals:** sleep quality, sleep efficiency, EEG or qEEG, mood, adverse events, tolerability.

**Protocol takeaway:** Keep this in the background bucket for mechanisms, safety, and protocol design questions; do not use it as direct whole-body efficacy evidence.

**Claim use:** `context-only`.
