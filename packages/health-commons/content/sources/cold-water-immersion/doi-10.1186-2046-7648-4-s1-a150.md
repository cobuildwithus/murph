---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-2046-7648-4-s1-a150
slug: sources/cold-water-immersion/doi-10.1186-2046-7648-4-s1-a150
title: Sleep quantity and quality during heat-based training and effects of cold-water immersion recovery
summary: Consecutive-day heat training worsened sleep quantity/quality, and adding post-training CWI did not significantly improve the sleep outcomes in this meeting abstract.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: journal_article
  title: Sleep quantity and quality during heat-based training and effects of cold-water immersion recovery
  authors: Minett GM; Gale R; Wingfield G; Marino FE; Washington TL; Skein M
  year: 2015
  journal: Extreme Physiology & Medicine
  doi: 10.1186/2046-7648-4-s1-a150
  url: https://doi.org/10.1186/2046-7648-4-S1-A150
  citation: Minett GM; Gale R; Wingfield G; Marino FE; Washington TL; Skein M. Sleep quantity and quality during heat-based training and effects of cold-water immersion recovery. Extreme Physiology & Medicine. 2015. doi:10.1186/2046-7648-4-S1-A150.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1186/2046-7648-4-s1-a150
    titleHash: 83332d04520f84cb49165d14f20fbb0ddbbbca134bced5c36c4c4ca3253182e6
    url: https://doi.org/10.1186/2046-7648-4-s1-a150
  canonicalUrl: https://doi.org/10.1186/2046-7648-4-S1-A150
  identityAliases:
  - DOI 10.1186/2046-7648-4-S1-A150
  - Sleep quantity and quality during heat-based training and effects of cold-water immersion recovery
researchEvidence:
  designKind: other
  designLabel: 'Meeting abstract: three-condition heat-training sleep study'
  populationLabel: Recreationally trained male participants completing consecutive-day heat training
  durationLabel: Five days of heat-based training with baseline comparison
  cohortKey: cohort:doi-10-1186-2046-7648-4-s1-a150
  participantCount: 30
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Cold Plunge extraction context: bucket=Sleep, HRV, and recovery context; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.1186-2046-7648-4-s1-a150:cwi-no-sleep-effect
  sourceKey: source_artifact:doi-10.1186-2046-7648-4-s1-a150
  extractedFromArtifactId: art_doi_10_1186_2046_7648_4_s1_a150
  findingKind: intervention_result
  population: Recreationally trained men during consecutive-day heat training
  exposure: Post-training CWI after heat-based cycling sessions
  outcome: Actigraphy and subjective sleep quantity/quality
  summary: The abstract reported that CWI did not significantly blunt heat-training-related sleep disruption.
  evidenceUse:
  - adjacent_variant
  - measurement
- findingId: finding:doi-10.1186-2046-7648-4-s1-a150:heat-training-sleep-disruption
  sourceKey: source_artifact:doi-10.1186-2046-7648-4-s1-a150
  extractedFromArtifactId: art_doi_10_1186_2046_7648_4_s1_a150
  findingKind: context
  population: Recreationally trained men
  exposure: Five days of heat-based training
  outcome: Sleep quantity and quality
  summary: Heat training itself was associated with reduced total sleep time and greater wakefulness versus baseline, making training context an important confounder.
  evidenceUse:
  - context
coldPlungeExtraction:
  batchId: batch-007
  evidenceBucket: Sleep, HRV, and recovery context
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- DOI 10.1186/2046-7648-4-S1-A150
- Sleep quantity and quality during heat-based training and effects of cold-water immersion recovery
- 10.1186/2046-7648-4-s1-a150
---

This source is included for **Sleep, HRV, and recovery context**.

**Findings:** The abstract reported that CWI did not significantly blunt heat-training-related sleep disruption.; Heat training itself was associated with reduced total sleep time and greater wakefulness versus baseline, making training context an important confounder.

**Why it matters:** Preserves a negative sleep-recovery finding and helps prevent overclaiming CWI as a universal sleep aid after hard training.

**Potential experiment signals:** biomarker:sleep-efficiency, biomarker:sleep-onset-latency, self_report:sleep_quality.

**Protocol takeaway:** Use as adjacent heat-training recovery evidence showing no clear sleep benefit from CWI.

**Claim use:** `context-only`.
