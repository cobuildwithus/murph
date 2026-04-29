---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1093-sleepadvances-zpaf021
slug: sources/caffeine-timing/doi-10.1093-sleepadvances-zpaf021
title: A performance validation of six commercial wrist-worn wearable sleep-tracking devices for sleep stage scoring compared to polysomnography
summary: All devices required improvement for multistate sleep-stage categorization; Fitbit Sense, Fitbit Charge 5, and Apple Watch Series 8 had the strongest agreement among tested devices but were still appropriate mainly for sustained or large architecture changes rather than precise single-night staging.
status: draft
quality: usable
aliases:
- A performance validation of six commercial wrist-worn wearable sleep-tracking devices for sleep stage scoring compared to polysomnography
- source_artifact:doi-10.1093-sleepadvances-zpaf021
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: journal_article
  title: A performance validation of six commercial wrist-worn wearable sleep-tracking devices for sleep stage scoring compared to polysomnography
  authors: Schyvens AM; Peters B; Van Oost NC; Aerts JM; Masci F; Neven A; Dirix H; Wets G; Ross V; Verbraecken J
  year: 2025
  journal: Sleep Advances
  citation: Schyvens AM; Peters B; Van Oost NC; Aerts JM; Masci F; Neven A; Dirix H; Wets G; Ross V; Verbraecken J. A performance validation of six commercial wrist-worn wearable sleep-tracking devices for sleep stage scoring compared to polysomnography. Sleep Advances. 2025. doi:10.1093/sleepadvances/zpaf021. PMID:40303381. PMCID:PMC12038347.
  pmid: '40303381'
  doi: 10.1093/sleepadvances/zpaf021
  url: https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmid: '40303381'
    doi: 10.1093/sleepadvances/zpaf021
    pmcid: PMC12038347
    titleHash: c54097e9948fb21cdc6697a6d5b3520a247561511f66d77dfebc676d3f7033ad
    url: https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472
  canonicalUrl: https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472
researchEvidence:
  designKind: other
  designLabel: Wrist-worn wearable sleep-stage validation against PSG
  participantCount: 62
  participantCountKind: reported
  populationLabel: Adults with suspected sleep apnea and healthy participants in a sleep-laboratory validation study.
  durationLabel: One simultaneous overnight PSG and wearable recording session.
  aggregateRole: primary
  cohortKey: doi-10.1093-sleepadvances-zpaf021
  notes:
  - 'Intervention or exposure: Fitbit Charge 5, Fitbit Sense, Withings Scanwatch, Garmin Vivosmart 4, WHOOP 4.0, and Apple Watch Series 8 sleep outputs.'
  - 'Comparator or control: Polysomnography scored as the reference standard.'
  - 'Endpoints: sleep onset latency, total sleep time, sleep efficiency, wake after sleep onset, sleep stages, REM sleep, deep sleep'
  - 'Effect or direction: All devices required improvement for multistate sleep-stage categorization; Fitbit Sense, Fitbit Charge 5, and Apple Watch Series 8 had the strongest agreement among tested devices but were still appropriate mainly for sustained or large architecture changes rather than precise single-night staging.'
  - 'Adverse events or safety notes: No caffeine intervention or adverse-event assessment; measurement-only validation.'
  - 'Population mismatch: Measurement context only; not a caffeine curfew or dose-reset intervention.'
  - 'Limitations: Single-night sleep-laboratory validation; mostly male sample; suspected sleep apnea and healthy participants may not represent all Murph users; device firmware and algorithms can change.'
evidenceBucket: measurement_wearables_psg_actigraphy
whyItMatters: Very recent multi-device PSG validation helps set guardrails for interpreting consumer sleep-stage outputs during a caffeine-curfew experiment.
potentialMurphEndpoints:
- sleep onset latency
- total sleep time
- sleep efficiency
- wake after sleep onset
- sleep stages
- REM sleep
- deep sleep
protocolTakeaway: Use wearable TST/SE trends as supportive signals, but do not treat single-night REM/deep-stage changes as PSG-equivalent outcomes.
murphTakeaway: Consumer wrist wearables can support trend tracking, but stage-level readouts need cautious language and repeated-night context.
studyDesign: measurement_validation
modality: wrist-wearable-psg-validation
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.1093-sleepadvances-zpaf021-measurement-validation
  sourceKey: source_artifact:doi-10.1093-sleepadvances-zpaf021
  extractedFromArtifactId: art_doi_10_1093_sleepadvances_zpaf021_html
  findingKind: measurement_validation
  population: Adults with suspected sleep apnea and healthy participants in a sleep-laboratory validation study.
  exposure: Fitbit Charge 5, Fitbit Sense, Withings Scanwatch, Garmin Vivosmart 4, WHOOP 4.0, and Apple Watch Series 8 sleep outputs.
  outcome: sleep onset latency, total sleep time, sleep efficiency, wake after sleep onset, sleep stages, REM sleep, deep sleep
  summary: All devices required improvement for multistate sleep-stage categorization; Fitbit Sense, Fitbit Charge 5, and Apple Watch Series 8 had the strongest agreement among tested devices but were still appropriate mainly for sustained or large architecture changes rather than precise single-night staging.
  evidenceUse:
  - measurement
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **measurement_wearables_psg_actigraphy**.

**Findings:** All devices required improvement for multistate sleep-stage categorization; Fitbit Sense, Fitbit Charge 5, and Apple Watch Series 8 had the strongest agreement among tested devices but were still appropriate mainly for sustained or large architecture changes rather than precise single-night staging.

**Why it matters:** Very recent multi-device PSG validation helps set guardrails for interpreting consumer sleep-stage outputs during a caffeine-curfew experiment.

**Potential experiment signals:** sleep onset latency, total sleep time, sleep efficiency, wake after sleep onset, sleep stages, REM sleep, deep sleep.

**Protocol takeaway:** Use wearable TST/SE trends as supportive signals, but do not treat single-night REM/deep-stage changes as PSG-equivalent outcomes.

**Claim use:** `context-only`.
