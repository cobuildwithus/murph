---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-s12984-022-01085-5
slug: sources/daily-step-floor/doi-10.1186-s12984-022-01085-5
title: 'Criterion validity of ActiGraph monitoring devices for step counting and distance measurement in adults and older adults: a systematic review'
summary: Systematic review summarizing criterion validity of ActiGraph step counting and distance measurement in adults and older adults.
status: draft
quality: usable
aliases:
- doi-10.1186-s12984-022-01085-5
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: review
  title: 'Criterion validity of ActiGraph monitoring devices for step counting and distance measurement in adults and older adults: a systematic review'
  authors: Armelle-Myriane Ngueleu; Corentin Barthod; Krista Lynn Best; François Routhier; Martin Otis; Charles Sèbiyo Batcho
  year: 2022
  journal: Journal of NeuroEngineering and Rehabilitation
  doi: 10.1186/s12984-022-01085-5
  url: https://doi.org/10.1186/s12984-022-01085-5
  citation: 'Ngueleu AM, Barthod C, Best KL, Routhier F, Otis M, Batcho CS. Criterion validity of ActiGraph monitoring devices for step counting and distance measurement in adults and older adults: a systematic review. Journal of NeuroEngineering and Rehabilitation. 2022;19:112. doi:10.1186/s12984-022-01085-5'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC9575229
    doi: 10.1186/s12984-022-01085-5
    titleHash: 825a34464426c0038885c04f629c4e3f920d33f1b288ad7c03b2dfab0c2610af
    url: https://doi.org/10.1186/s12984-022-01085-5
  canonicalUrl: https://doi.org/10.1186/s12984-022-01085-5
researchEvidence:
  designKind: systematic_review
  designLabel: Systematic review of ActiGraph criterion validity
  populationLabel: Adults and older adults in ActiGraph criterion-validity studies
  durationLabel: Included protocols ranged from 2 minutes to 3 days
  cohortKey: actigraph-step-count-validity-review
  participantCount: 637
  aggregateRole: synthesis
evidenceBucket: measurement_validity
whyItMatters: ActiGraph devices are common research comparators; this source keeps protocol measurement claims cautious about placement, speed, and processing.
potentialMurphEndpoints:
- daily steps
- step-count measurement validity
- device/placement bias
- wear-time or multi-day reliability
protocolTakeaway: Use as measurement-context evidence that research-grade devices are not interchangeable without model, placement, speed, and processing details.
murphTakeaway: Daily Step Floor step counts should treat ActiGraph-derived and consumer-device-derived steps as device-specific rather than universal.
studyDesign: Systematic review of ActiGraph criterion validity
modality: Step-count measurement validity / wearable and smartphone tracking
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10-1186-s12984-022-01085-5:measurement-validation
  sourceKey: source_artifact:doi-10.1186-s12984-022-01085-5
  extractedFromArtifactId: art_doi_10_1186_s12984_022_01085_5
  findingKind: measurement_validation
  population: Adults and older adults in ActiGraph criterion-validity studies
  exposure: ActiGraph devices for step counting and distance estimation
  outcome: step-count criterion validity; distance-estimation validity; effects of speed, placement, and data processing
  summary: Across 21 studies and 637 participants, ActiGraph step-count validity depended on model, speed, placement, and processing; newer GT3X+/wGT3X+ and wGT3X-BT models performed better than older models under some conditions.
  evidenceUse:
  - measurement
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **measurement_validity**.

**Findings:** Across 21 studies and 637 participants, ActiGraph step-count validity depended on model, speed, placement, and processing; newer GT3X+/wGT3X+ and wGT3X-BT models performed better than older models under some conditions.

**Why it matters:** ActiGraph devices are common research comparators; this source keeps protocol measurement claims cautious about placement, speed, and processing.

**Potential experiment signals:** Daily steps, step-count measurement validity, device/placement bias, wear-time, and multi-day reliability.

**Protocol takeaway:** Use as measurement-context evidence that research-grade devices are not interchangeable without model, placement, speed, and processing details.

**Claim use:** `context-only`.

**Directness boundary:** This is measurement-context evidence for Daily Step Floor. It should not be promoted into a direct claim that the protocol increases steps, improves biomarkers, or causes health outcomes.

**Safety/adverse events:** No adverse-event extraction was made for this source in this batch; it was handled as measurement-validity or implementation-context evidence, not as a safety trial.
