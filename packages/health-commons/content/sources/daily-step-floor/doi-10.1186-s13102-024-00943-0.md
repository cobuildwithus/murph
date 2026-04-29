---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1186-s13102-024-00943-0
slug: sources/daily-step-floor/doi-10.1186-s13102-024-00943-0
title: 'Comparison of step-count outcomes across seven different activity trackers: a free-living experiment with young and older adults'
summary: Free-living comparison showing large differences in step-count outputs across device placement and age groups.
status: draft
quality: usable
aliases:
- doi-10.1186-s13102-024-00943-0
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: 'Comparison of step-count outcomes across seven different activity trackers: a free-living experiment with young and older adults'
  authors: Takashi Nakagata; Yosuke Yamada; Masashi Taniguchi; Hinako Nanri; Misaka Kimura; Motohiko Miyachi; Rei Ono
  year: 2024
  journal: BMC Sports Science, Medicine and Rehabilitation
  doi: 10.1186/s13102-024-00943-0
  url: https://doi.org/10.1186/s13102-024-00943-0
  citation: 'Nakagata T, Yamada Y, Taniguchi M, et al. Comparison of step-count outcomes across seven different activity trackers: a free-living experiment with young and older adults. BMC Sports Science, Medicine and Rehabilitation. 2024;16:156. doi:10.1186/s13102-024-00943-0'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC11264768
    doi: 10.1186/s13102-024-00943-0
    titleHash: 363f1de894668ca070ef1dbb272a1c2e48b7f11c23a22b510c0a000c8500ec45
    url: https://doi.org/10.1186/s13102-024-00943-0
  canonicalUrl: https://doi.org/10.1186/s13102-024-00943-0
researchEvidence:
  designKind: cross_sectional
  designLabel: Free-living concurrent device-comparison study
  populationLabel: 35 younger adults aged 21-43 years and 57 physically independent older adults aged 65-91 years
  durationLabel: Six to seven days of free-living wear reported in extracted source material
  cohortKey: young-older-seven-trackers-free-living
  participantCount: 92
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: measurement_validity
whyItMatters: Directly relevant to interpreting Daily Step Floor logs when users switch devices or compare wrist- and hip-derived step counts.
potentialMurphEndpoints:
- daily steps
- step-count measurement validity
- device/placement bias
- wear-time or multi-day reliability
protocolTakeaway: Do not compare Daily Step Floor step totals across devices or placements as if they are equivalent.
murphTakeaway: Flag device and wear location whenever Daily Step Floor users log steps; wrist-worn and hip-worn outputs can diverge by thousands of steps.
studyDesign: Free-living concurrent device-comparison study
modality: Step-count measurement validity / wearable and smartphone tracking
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10-1186-s13102-024-00943-0:measurement-validation
  sourceKey: source_artifact:doi-10.1186-s13102-024-00943-0
  extractedFromArtifactId: art_doi_10_1186_s13102_024_00943_0
  findingKind: measurement_validation
  population: 35 younger adults aged 21-43 years and 57 physically independent older adults aged 65-91 years
  exposure: Simultaneous wear of one pedometer and six activity trackers, including wrist- and hip-worn ActiGraph and several hip-worn devices
  outcome: daily steps by device; wrist-vs-hip step-count difference; between-device correlations
  summary: In a 92-person free-living comparison, wrist-worn ActiGraph step counts were substantially higher than hip-worn tracker counts, with a larger wrist-to-hip difference in older adults.
  evidenceUse:
  - measurement
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **measurement_validity**.

**Findings:** In a 92-person free-living comparison, wrist-worn ActiGraph step counts were substantially higher than hip-worn tracker counts, with a larger wrist-to-hip difference in older adults.

**Why it matters:** Directly relevant to interpreting Daily Step Floor logs when users switch devices or compare wrist- and hip-derived step counts.

**Potential experiment signals:** Daily steps, step-count measurement validity, device/placement bias, wear-time, and multi-day reliability.

**Protocol takeaway:** Do not compare Daily Step Floor step totals across devices or placements as if they are equivalent.

**Claim use:** `context-only`.

**Directness boundary:** This is measurement-context evidence for Daily Step Floor. It should not be promoted into a direct claim that the protocol increases steps, improves biomarkers, or causes health outcomes.

**Safety/adverse events:** No adverse-event extraction was made for this source in this batch; it was handled as measurement-validity or implementation-context evidence, not as a safety trial.
