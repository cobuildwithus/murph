---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-technologies11010029
slug: sources/daily-step-floor/doi-10.3390-technologies11010029
title: Validity of Wearable Monitors and Smartphone Applications for Measuring Steps in Semi-Structured and Free-Living Settings
summary: Validation study showing controlled-condition accuracy does not necessarily carry into free-living step counting.
status: draft
quality: usable
aliases:
- doi-10.3390-technologies11010029
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Validity of Wearable Monitors and Smartphone Applications for Measuring Steps in Semi-Structured and Free-Living Settings
  authors: Manolis Adamakis
  year: 2023
  journal: Technologies
  doi: 10.3390/technologies11010029
  url: https://doi.org/10.3390/technologies11010029
  citation: Adamakis M. Validity of wearable monitors and smartphone applications for measuring steps in semi-structured and free-living settings. Technologies. 2023;11(1):29. doi:10.3390/technologies11010029
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.3390/technologies11010029
    titleHash: bc15b9f1b2f7201f87a78d65c1ce0c611dc5dbaf7edc08a2e8b8f88b32c9d687
    url: https://doi.org/10.3390/technologies11010029
  canonicalUrl: https://doi.org/10.3390/technologies11010029
researchEvidence:
  designKind: cross_sectional
  designLabel: Semi-structured and free-living criterion-validity study
  populationLabel: Healthy adults; extracted source material reported 14 male and 10 female participants with mean age about 32.6 years
  durationLabel: Semi-structured lab assessment plus three-day free-living assessment
  cohortKey: healthy-adult-wearable-smartphone-step-validation
  participantCount: 24
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: measurement_validity
whyItMatters: Daily Step Floor relies on free-living steps, so this source warns against relying only on lab-style validation evidence.
potentialMurphEndpoints:
- daily steps
- step-count measurement validity
- device/placement bias
- wear-time or multi-day reliability
protocolTakeaway: Prefer devices and data-handling rules validated in free-living contexts for step-floor claims.
murphTakeaway: A Daily Step Floor log should be interpreted as a practical self-tracking signal, not a precise universal step-count truth.
studyDesign: Semi-structured and free-living criterion-validity study
modality: Step-count measurement validity / wearable and smartphone tracking
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10-3390-technologies11010029:measurement-validation
  sourceKey: source_artifact:doi-10.3390-technologies11010029
  extractedFromArtifactId: art_doi_10_3390_technologies11010029
  findingKind: measurement_validation
  population: Healthy adults; extracted source material reported 14 male and 10 female participants with mean age about 32.6 years
  exposure: Wearable monitors and Android smartphone step-count applications
  outcome: step-count MAPE; Bland-Altman agreement; intraclass correlation
  summary: Semi-structured wearable-monitor step-count validity was better than smartphone-app validity, but all tested monitors/apps had high free-living MAPE above 10%.
  evidenceUse:
  - measurement
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **measurement_validity**.

**Findings:** Semi-structured wearable-monitor step-count validity was better than smartphone-app validity, but all tested monitors/apps had high free-living MAPE above 10%.

**Why it matters:** Daily Step Floor relies on free-living steps, so this source warns against relying only on lab-style validation evidence.

**Potential experiment signals:** Daily steps, step-count measurement validity, device/placement bias, wear-time, and multi-day reliability.

**Protocol takeaway:** Prefer devices and data-handling rules validated in free-living contexts for step-floor claims.

**Claim use:** `context-only`.

**Directness boundary:** This is measurement-context evidence for Daily Step Floor. It should not be promoted into a direct claim that the protocol increases steps, improves biomarkers, or causes health outcomes.

**Safety/adverse events:** No adverse-event extraction was made for this source in this batch; it was handled as measurement-validity or implementation-context evidence, not as a safety trial.
