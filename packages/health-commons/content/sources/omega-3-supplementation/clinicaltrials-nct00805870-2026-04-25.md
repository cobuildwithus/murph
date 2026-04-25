---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00805870-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct00805870-2026-04-25
title: The Effects of High Dose Fish Oil Supplementation on Delayed Onset Muscle Soreness and Inflammatory Markers
summary: Registry record for a high-dose fish-oil DOMS and inflammatory-marker trial; useful for protocol/design traceability rather than efficacy claims.
status: draft
quality: usable
aliases:
- clinicaltrials-nct00805870-2026-04-25
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
sourceKind: trial_registry
directnessToProtocol: direct_protocol
source:
  kind: web_page
  title: The Effects of High Dose Fish Oil Supplementation on Delayed Onset Muscle Soreness and Inflammatory Markers
  authors: ClinicalTrials.gov; Western Michigan University
  year: 2009
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. The Effects of High Dose Fish Oil Supplementation on Delayed Onset Muscle Soreness and Inflammatory Markers. NCT00805870.
  url: https://clinicaltrials.gov/study/NCT00805870
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Clinical trial registry record for an interventional fish-oil DOMS study
  populationLabel: Adults aged 18 to 30 years in a delayed-onset muscle soreness exercise model according to registry mirrors
  durationLabel: Registry design record; specific supplementation and follow-up windows not fully extracted here
  aggregateRole: primary
  cohortKey: clinicaltrials-nct00805870-high-dose-fish-oil-doms
  notes:
  - 'Participant count not extracted for this batch; count kind from notes: not_extracted.'
evidenceBucket: exercise_recovery_soreness
whyItMatters: It captures an exercise-recovery trial that may otherwise be unpublished or only reported in limited venues.
potentialMurphEndpoints:
- muscle soreness
- muscle strength
- CK
- inflammatory markers
protocolTakeaway: Registry-only source; do not use as an efficacy claim unless a citable results publication is extracted.
murphTakeaway: Registered endpoints show what researchers considered important to measure, not what users should expect to improve.
studyDesign: Clinical trial registry record for an interventional fish-oil DOMS study
modality: High-dose oral fish oil / omega-3-acid ethyl esters in a DOMS trial
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **exercise_recovery_soreness**.

**Findings:** The registry record describes a high-dose fish-oil study on delayed-onset muscle soreness and inflammatory markers, with outcomes including muscle strength, soreness, CK activity, and inflammatory markers. It is included as protocol/design evidence only. A non-registry mirror suggests a null result, but that was not treated as primary efficacy evidence in this extraction.

**Why it matters:** It captures an exercise-recovery trial that may otherwise be unpublished or only reported in limited venues.

**Potential experiment signals:** muscle soreness, muscle strength, CK, inflammatory markers.

**Protocol takeaway:** Registry-only source; do not use as an efficacy claim unless a citable results publication is extracted.

**Claim use:** `context-only`.
