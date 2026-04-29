---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1111-joop.12115
slug: sources/pre-sleep-downshift-practices/doi-10.1111-joop.12115
title: "A low-dose mindfulness intervention and recovery from work: Effects on psychological detachment, sleep quality, and sleep duration"
summary: "A low-dose mindfulness self-training field experiment in 140 employees improved sleep quality and sleep duration during daily assessment, but did not improve psychological detachment."
status: draft
quality: usable
aliases:
  - "A low-dose mindfulness intervention and recovery from work: Effects on psychological detachment, sleep quality, and sleep duration"
  - doi:10.1111/joop.12115
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
  title: "A low-dose mindfulness intervention and recovery from work: Effects on psychological detachment, sleep quality, and sleep duration"
  authors: Hülsheger UR; Feinholdt A; Nübold A
  year: 2015
  journal: Journal of Occupational and Organizational Psychology
  citation: "Hülsheger UR, Feinholdt A, Nübold A. A low-dose mindfulness intervention and recovery from work: Effects on psychological detachment, sleep quality, and sleep duration. Journal of Occupational and Organizational Psychology. 2015;88:464-489. doi:10.1111/joop.12115."
  doi: 10.1111/joop.12115
  url: https://doi.org/10.1111/joop.12115
sourceKind: journal_article
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1111/joop.12115
    titleHash: 78fb2b9972a966ede646521212d894ace7921e3985a1267bc7b02657c015c36f
    url: https://doi.org/10.1111/joop.12115
  canonicalUrl: https://doi.org/10.1111/joop.12115
researchEvidence:
  designKind: controlled_trial
  designLabel: Randomized field experiment with daily event-sampling
  participantCount: 140
  participantCountKind: reported
  populationLabel: Working adults/employees in a workplace recovery context.
  durationLabel: 10 workdays of daily event-sampling around the low-dose intervention.
  aggregateRole: primary
  cohortKey: cohort-doi-10.1111-joop.12115
  notes:
    - "Original extracted designKind: randomized_field_experiment."
    - "Intervention or exposure: Low-dose mindfulness self-training intervention."
    - "Comparator or control: Wait-list control."
    - "Endpoints: psychological detachment; sleep quality; sleep duration"
    - "Effect estimate or direction: Growth-curve analyses showed intervention effects on sleep quality and sleep duration, but no effect on psychological detachment."
    - "Adverse events or safety notes: No adverse-event signal extracted from the available record."
evidenceBucket: dose_duration_adherence_context
whyItMatters: Provides low-burden dose context while preventing a workplace recovery result from being treated as bedtime-silent meditation evidence.
potentialMurphEndpoints:
  - psychological detachment
  - sleep quality
  - sleep duration
protocolTakeaway: Use as low-dose feasibility and burden context only.
murphTakeaway: "Low-dose mindfulness can be feasible in daily life, but the setting and timing are not a Murph bedtime protocol."
studyDesign: Randomized field experiment with daily event-sampling
modality: Low-dose mindfulness self-training
directnessToProtocol: population_mismatch
populationMismatch: Employees in a work-recovery study rather than users with pre-sleep arousal or insomnia.
limitations:
  - Workplace recovery intervention rather than bedtime meditation.
  - Population not selected for insomnia or sleep-onset problems.
  - Does not isolate silent practice immediately before bed.
claimUse: context-only
sourceFindings:

  -
    findingId: finding:doi-10.1111-joop.12115-low-dose-work-recovery-sleep
    sourceKey: source_artifact:doi-10.1111-joop.12115
    extractedFromArtifactId: art_doi_10_1111_joop_12115_publisher_record
    findingKind: intervention_result
    population: Working adults/employees in a workplace recovery context.
    exposure: Low-dose mindfulness self-training intervention.
    outcome: psychological detachment; sleep quality; sleep duration
    summary: "A low-dose mindfulness self-training field experiment in 140 employees improved sleep quality and sleep duration during daily assessment, but did not improve psychological detachment."
    evidenceUse:
      - context
murphV1Priority: High
pdfRightsStatus: unknown
---
This source is included for **dose_duration_adherence_context**.

**Findings:** A low-dose mindfulness self-training field experiment in 140 employees improved sleep quality and sleep duration during daily assessment, but did not improve psychological detachment.

**Why it matters:** Provides low-burden dose context while preventing a workplace recovery result from being treated as bedtime-silent meditation evidence.

**Potential experiment signals:** psychological detachment, sleep quality, sleep duration.

**Protocol takeaway:** Use as low-dose feasibility and burden context only.

**Claim use:** `context-only`.
