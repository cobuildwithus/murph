---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:umin-r000063711-high-intensity-intermittent-cross-training-2024-10-08
slug: sources/tabata-interval-training/umin-r000063711-high-intensity-intermittent-cross-training-2024-10-08
title: Effects of high-intensity intermittent cross-training on maximal oxygen uptake
summary: UMIN-CTR registry record for a randomized parallel study of high-intensity intermittent cross-training in healthy young men using alternating 20-second treadmill and bicycle bouts separated by 10-second rests; included as adjacent 20/10 cross-training registry context, not direct original cycling Tabata evidence.
status: draft
quality: usable
aliases:
  - UMIN000055772
  - R000063711
  - HIICT VO2max registry
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    url: https://center6.umin.ac.jp/cgi-open-bin/ctr_e/ctr_view.cgi?recptno=R000063711
  canonicalUrl: https://center6.umin.ac.jp/cgi-open-bin/ctr_e/ctr_view.cgi?recptno=R000063711
sourceKind: trial_registry
source:
  kind: other
  title: Effects of high-intensity intermittent cross-training on maximal oxygen uptake
  authors: Izumi Tabata / UMIN-CTR registration
  year: 2024
  journal: UMIN Clinical Trials Registry
  url: https://center6.umin.ac.jp/cgi-open-bin/ctr_e/ctr_view.cgi?recptno=R000063711
  citation: UMIN-CTR. Effects of high-intensity intermittent cross-training on maximal oxygen uptake. UMIN000055772 / R000063711. Public disclosure October 8, 2024; last modified April 10, 2025. Accessed April 24, 2026. https://center6.umin.ac.jp/cgi-open-bin/ctr_e/ctr_view.cgi?recptno=R000063711.
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: UMIN registry record; randomized parallel design with no-treatment control
  participantCount: 16
  participantCountKind: reported
  populationLabel: Untrained healthy young adult males, age 18 to under 30
  durationLabel: Four days per week for six weeks
  cohortKey: umin-r000063711-high-intensity-intermittent-cross-training-2024-10-08
  aggregateRole: context
  notes:
    - Registry lists 16 enrolled participants and points to a published article, which should be extracted under its own source key for outcome claims.
evidenceBucket: trial_registry_context
whyItMatters: It preserves registration provenance for a modern Tabata-related cross-training study while keeping it separate from direct original protocol evidence.
potentialMurphEndpoints:
  - running VO2max
  - cycling VO2max
  - mode-specific oxygen demand
  - adverse-event field completeness
protocolTakeaway: Classify as adjacent 20/10 cross-training: same rest cadence, different exercise-mode sequence and population.
murphTakeaway: Use for registry context and as a pointer to a separately extractable open article, not as a standalone outcome source.
studyDesign: UMIN registry record for randomized parallel interventional study with no-treatment control.
modality: Alternating treadmill running and bicycle ergometer high-intensity intermittent cross-training
directness: adjacent_variant
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
relatedPublications:
  -
    citation: Liu X, Tsuji K, Xu Y, Iemitsu M, Tabata I. Effects of high-intensity intermittent cross-training on maximal oxygen uptake. Sports Medicine and Health Science. 2024 Nov 9;7(3):185-189.
    doi: 10.1016/j.smhs.2024.11.003
    pmid: "39991126"
    pmcid: PMC11846435
    extractionStatus: not_extracted_in_batch_009
sourceExtractionBatch: 12-source-extraction-009
---
This source is included for **trial_registry_context**.

**Findings:**
- The registry records an interventional randomized parallel study in healthy young males, with a high-intensity intermittent cross-training group and sedentary/no-treatment control.
- The registered HIICT exposure uses alternating 20-second treadmill and bicycle bouts separated by 10-second rests, performed four days per week for six weeks, with maximal oxygen uptake as the primary outcome.

**Why it matters:** It preserves registration provenance for a modern Tabata-related cross-training study while keeping it separate from direct original protocol evidence.

**Potential experiment signals:** running VO2max, cycling VO2max, mode-specific oxygen demand, adverse-event field completeness.

**Protocol takeaway:** Classify as adjacent 20/10 cross-training: same rest cadence, different exercise-mode sequence and population.

**Limitations and boundaries:**
- Registry fields do not supply extractable effect estimates for this batch.
- The linked journal article is identified but not extracted here and should receive a separate DOI/PMID source key.
- Adverse-event details are not populated in the extracted registry fields.

**Claim use:** `context-only`.
