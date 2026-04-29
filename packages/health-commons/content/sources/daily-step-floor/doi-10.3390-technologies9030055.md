---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-technologies9030055
slug: sources/daily-step-floor/doi-10.3390-technologies9030055
title: Criterion Validity of iOS and Android Applications to Measure Steps and Distance in Adults
summary: Laboratory criterion-validity study of iOS and Android step-count/distance apps in healthy adults.
status: draft
quality: usable
aliases:
- Adamakis 2021 smartphone app criterion validity for steps and distance
- doi-10.3390-technologies9030055
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Criterion Validity of iOS and Android Applications to Measure Steps and Distance in Adults
  authors: Adamakis M
  year: 2021
  journal: Technologies
  doi: 10.3390/technologies9030055
  url: https://doi.org/10.3390/technologies9030055
  citation: Adamakis M. Criterion Validity of iOS and Android Applications to Measure Steps and Distance in Adults. Technologies. 2021;9(3):55. doi:10.3390/technologies9030055.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.3390/technologies9030055
    titleHash: 9648a91c3797cdb153ef05305ad5e875954fe674e4140cc4913b0b4c508245c6
    url: https://doi.org/10.3390/technologies9030055
  canonicalUrl: https://doi.org/10.3390/technologies9030055
researchEvidence:
  designKind: cross_sectional
  designLabel: Laboratory treadmill criterion-validity study
  populationLabel: Thirty healthy adults; accessible extract reported mean age 25.9 years (SD 5.7).
  durationLabel: Single laboratory session with five-minute trials at 4.8, 6.0, and 8.4 km/h.
  cohortKey: cohort:daily-step-floor/doi-10.3390-technologies9030055
  participantCount: 30
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: measurement_validity
whyItMatters: Smartphone app, operating system, and movement speed can influence step measurement used in a step-floor protocol.
potentialMurphEndpoints:
- daily_step_count
- step_count_accuracy
- device_placement_or_carriage
- gait_speed_or_gait_aid_context
protocolTakeaway: Use as measurement-context evidence; avoid treating all smartphone apps as equivalent without app-specific validation.
murphTakeaway: If using app-based counts, record app, phone platform, placement, and whether measurements occur in controlled or free-living settings.
studyDesign: laboratory_criterion_validity_study
modality: step_count_measurement
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/doi-10.3390-technologies9030055/measurement-validation
  sourceKey: source_artifact:doi-10.3390-technologies9030055
  extractedFromArtifactId: art_doi_10_3390_technologies9030055_source_extract
  findingKind: measurement_validation
  population: Thirty healthy adults; accessible extract reported mean age 25.9 years (SD 5.7).
  exposure: Android and iOS smartphones running four step/distance applications during treadmill walking and jogging.
  outcome: steps; distance; criterion validity across smartphone platform/app/speed
  summary: Thirty healthy adults completed treadmill walking/jogging trials while Android and iOS apps estimated steps and distance against manual step counts; the source supports app/platform/speed measurement-validity context rather than efficacy claims.
  evidenceUse:
  - measurement
  - context
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **measurement_validity**.

**Findings:** Thirty healthy adults completed treadmill walking/jogging trials while Android and iOS apps estimated steps and distance against manual step counts; the source supports app/platform/speed measurement-validity context rather than efficacy claims.

**Why it matters:** Smartphone app, operating system, and movement speed can influence step measurement used in a step-floor protocol.

**Potential experiment signals:** daily_step_count, step_count_accuracy, device_placement_or_carriage, gait_speed_or_gait_aid_context.

**Protocol takeaway:** Use as measurement-context evidence; avoid treating all smartphone apps as equivalent without app-specific validation.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Thirty healthy adults; accessible extract reported mean age 25.9 years (SD 5.7).
- **Exposure/intervention:** Android and iOS smartphones running four step/distance applications during treadmill walking and jogging.
- **Comparator/control:** Two-researcher manual step tally during treadmill trials.
- **Duration/follow-up:** Single laboratory session with five-minute trials at 4.8, 6.0, and 8.4 km/h.
- **Endpoints:** steps, distance, criterion validity across smartphone platform/app/speed
- **Effect estimates or direction:** The accessible extract documents the validation design and devices but did not provide all app-level numerical effects; the study is useful for app/platform/speed measurement context.
- **Adverse events/safety notes:** No adverse events or safety outcomes were reported in the accessible extract.
- **Limitations:** Healthy young adult sample.; Treadmill setting may not match free-living step-floor behavior.; Full app-specific estimates were not available in the accessible extract used for this draft.
- **Population mismatch:** Healthy laboratory validation, not a Daily Step Floor intervention trial.
- **Artifact rights:** open_access
