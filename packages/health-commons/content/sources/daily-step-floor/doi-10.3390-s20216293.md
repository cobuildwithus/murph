---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-s20216293
slug: sources/daily-step-floor/doi-10.3390-s20216293
title: Accuracy of Mobile Applications versus Wearable Devices in Long-Term Step Measurements
summary: Open-access validation study showing that smartphone step applications can diverge from wearable devices during long-term free-living monitoring because phones are not continuously carried.
status: draft
quality: usable
aliases:
- Piccinini et al. 2020 mobile applications versus wearable devices long-term step measurement
- doi-10.3390-s20216293
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Accuracy of Mobile Applications versus Wearable Devices in Long-Term Step Measurements
  authors: Piccinini F, Martinelli G, Carbonaro A
  year: 2020
  journal: Sensors
  doi: 10.3390/s20216293
  url: https://doi.org/10.3390/s20216293
  citation: Piccinini F, Martinelli G, Carbonaro A. Accuracy of Mobile Applications versus Wearable Devices in Long-Term Step Measurements. Sensors. 2020;20(21):6293. doi:10.3390/s20216293.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC7663794
    doi: 10.3390/s20216293
    titleHash: 3e6149b4dbefe5871e00ccf34330951a4af59b080f22a4442c30180c2618b523
    url: https://doi.org/10.3390/s20216293
  canonicalUrl: https://doi.org/10.3390/s20216293
researchEvidence:
  designKind: controlled_trial
  designLabel: Controlled outdoor and long-term free-living validation study
  populationLabel: Long-term free-living experiment in one healthy 35-year-old man; controlled short-term outdoor tests also used video ground truth.
  durationLabel: 2 months for long-term 24-hours-per-day/7-days-per-week monitoring
  cohortKey: cohort:daily-step-floor/doi-10.3390-s20216293
  participantCount: 1
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: measurement_validity
whyItMatters: A phone-measured step floor can miss steps when the phone is left behind, even if the app performs acceptably in controlled testing.
potentialMurphEndpoints:
- daily_step_count
- step_count_accuracy
- device_placement_or_carriage
- gait_speed_or_gait_aid_context
protocolTakeaway: Use as context-only evidence to prefer continuously worn devices or to document phone-carriage rules.
murphTakeaway: Phone-app steps should not be assumed equivalent to wrist-worn tracker steps over long periods.
studyDesign: controlled_and_free_living_validation_study
modality: step_count_measurement
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/doi-10.3390-s20216293/measurement-validation
  sourceKey: source_artifact:doi-10.3390-s20216293
  extractedFromArtifactId: art_doi_10_3390_s20216293_source_extract
  findingKind: measurement_validation
  population: Long-term free-living experiment in one healthy 35-year-old man; controlled short-term outdoor tests also used video ground truth.
  exposure: Three wearable fitness wristbands and six smartphone step-count applications.
  outcome: step count; application-device agreement; long-term measurement difference
  summary: Mobile apps and wearables can perform similarly in controlled short-term step tests, but long-term phone-based step totals may differ substantially from wearable totals because the phone is not always carried.
  evidenceUse:
  - measurement
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **measurement_validity**.

**Findings:** Mobile apps and wearables can perform similarly in controlled short-term step tests, but long-term phone-based step totals may differ substantially from wearable totals because the phone is not always carried.

**Why it matters:** A phone-measured step floor can miss steps when the phone is left behind, even if the app performs acceptably in controlled testing.

**Potential experiment signals:** daily_step_count, step_count_accuracy, device_placement_or_carriage, gait_speed_or_gait_aid_context.

**Protocol takeaway:** Use as context-only evidence to prefer continuously worn devices or to document phone-carriage rules.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Long-term free-living experiment in one healthy 35-year-old man; controlled short-term outdoor tests also used video ground truth.
- **Exposure/intervention:** Three wearable fitness wristbands and six smartphone step-count applications.
- **Comparator/control:** Video-recorded ground truth in controlled tests; wearable/mobile agreement patterns during continuous long-term monitoring.
- **Duration/follow-up:** 2 months for long-term 24-hours-per-day/7-days-per-week monitoring
- **Endpoints:** step count, application-device agreement, long-term measurement difference
- **Effect estimates or direction:** Controlled short-term testing suggested smartphone app accuracy could be comparable to wearables, but long-term estimates differed because smartphones were not worn continuously; accessible extracts reported discrepancies around 30% in long-term monitoring.
- **Adverse events/safety notes:** No adverse events or safety outcomes were reported.
- **Limitations:** Long-term component was a single-participant experiment.; Smartphone carriage behavior is a measurement limitation.; Firmware and app updates may change accuracy.
- **Population mismatch:** Healthy single-participant long-term monitoring is measurement context, not efficacy evidence for a Daily Step Floor.
- **Artifact rights:** open_access
