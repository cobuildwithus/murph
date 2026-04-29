---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1123-jmpb.2022-0022
slug: sources/daily-step-floor/doi-10.1123-jmpb.2022-0022
title: Validation of Smartphones and Different Low-Cost Activity Trackers for Step Counting Under Free-Living Conditions
summary: Free-living validation study comparing smartphones and low-cost trackers for step counting; tracker accuracy was materially better than smartphone step counts in the accessible abstract.
status: draft
quality: usable
aliases:
- Goh et al. 2023 low-cost trackers and smartphone free-living step-count validation
- doi-10.1123-jmpb.2022-0022
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Validation of Smartphones and Different Low-Cost Activity Trackers for Step Counting Under Free-Living Conditions
  authors: Goh CMJL, Wang NX, Müller AM, Yap R, Edney S, Müller-Riemenschneider F
  year: 2023
  journal: Journal for the Measurement of Physical Behaviour
  doi: 10.1123/jmpb.2022-0022
  url: https://doi.org/10.1123/jmpb.2022-0022
  citation: Goh CMJL, Wang NX, Müller AM, Yap R, Edney S, Müller-Riemenschneider F. Validation of Smartphones and Different Low-Cost Activity Trackers for Step Counting Under Free-Living Conditions. Journal for the Measurement of Physical Behaviour. 2023;6(1):79-87. doi:10.1123/jmpb.2022-0022.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1123/jmpb.2022-0022
    titleHash: dd2a0fd2b87e2d8f6b093ff204d6a8bceb0d1218cbcfe41bf0bbc8d3be89098a
    url: https://doi.org/10.1123/jmpb.2022-0022
  canonicalUrl: https://doi.org/10.1123/jmpb.2022-0022
researchEvidence:
  designKind: cross_sectional
  designLabel: Free-living step-count validation study
  populationLabel: Free-living adults; participant count and demographic details were not available in the accessible extract.
  durationLabel: 3 days
  cohortKey: cohort:daily-step-floor/doi-10.1123-jmpb.2022-0022
  aggregateRole: primary
evidenceBucket: measurement_validity
whyItMatters: Daily Step Floor outcomes can be distorted when phone carriage and tracker choice change the recorded step count.
potentialMurphEndpoints:
- daily_step_count
- step_count_accuracy
- device_placement_or_carriage
- gait_speed_or_gait_aid_context
protocolTakeaway: Use as context-only evidence that free-living step counts depend on device class; do not treat smartphone and tracker counts as interchangeable.
murphTakeaway: For step-floor experiments, prefer a consistent validated tracker and document phone/device type.
studyDesign: free_living_validation_study
modality: step_count_measurement
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/doi-10.1123-jmpb.2022-0022/measurement-validation
  sourceKey: source_artifact:doi-10.1123-jmpb.2022-0022
  extractedFromArtifactId: art_doi_10_1123_jmpb_2022_0022_source_extract
  findingKind: measurement_validation
  population: Free-living adults; participant count and demographic details were not available in the accessible extract.
  exposure: Seven low-cost wrist-worn activity trackers and smartphone step counting under free-living conditions.
  outcome: daily step count; criterion validity; mean absolute percentage error; intraclass correlation; Pearson correlation
  summary: In a 3-day free-living comparison, low-cost wrist trackers generally had stronger step-count criterion validity than smartphone step counts against a Yamax pedometer; several trackers underestimated and the smartphone overestimated steps.
  evidenceUse:
  - measurement
  - context
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **measurement_validity**.

**Findings:** In a 3-day free-living comparison, low-cost wrist trackers generally had stronger step-count criterion validity than smartphone step counts against a Yamax pedometer; several trackers underestimated and the smartphone overestimated steps.

**Why it matters:** Daily Step Floor outcomes can be distorted when phone carriage and tracker choice change the recorded step count.

**Potential experiment signals:** daily_step_count, step_count_accuracy, device_placement_or_carriage, gait_speed_or_gait_aid_context.

**Protocol takeaway:** Use as context-only evidence that free-living step counts depend on device class; do not treat smartphone and tracker counts as interchangeable.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Free-living adults; participant count and demographic details were not available in the accessible extract.
- **Exposure/intervention:** Seven low-cost wrist-worn activity trackers and smartphone step counting under free-living conditions.
- **Comparator/control:** Yamax pedometer criterion/reference step counter.
- **Duration/follow-up:** 3 days
- **Endpoints:** daily step count, criterion validity, mean absolute percentage error, intraclass correlation, Pearson correlation
- **Effect estimates or direction:** Five of seven trackers underestimated steps, while two trackers and the smartphone overestimated steps. The accessible abstract reported stronger criterion validity for trackers than for smartphone steps: tracker correlations r=.78-.92, MAPE 14.5%-36.1%, ICC .51-.91; smartphone correlation r=.37, MAPE 55.7%, ICC .36.
- **Adverse events/safety notes:** No adverse events or safety outcomes were reported in the accessible extract.
- **Limitations:** Participant count and detailed demographics were not available in the accessible extract.; Device-specific performance may not generalize to other tracker models or firmware versions.; Reference was a pedometer rather than direct observation.
- **Population mismatch:** Measurement-context evidence only; not an intervention trial of a Daily Step Floor.
- **Artifact rights:** permission_required
