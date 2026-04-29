---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.5888-pcd19.210343
slug: sources/daily-step-floor/doi-10.5888-pcd19.210343
title: Comparison of Wrist- and Hip-Worn Activity Monitors When Meeting Step Guidelines
summary: Wrist and hip devices can move in opposite directions depending on activity type when applying step-count guidelines.
status: draft
quality: usable
aliases:
- doi-10.5888-pcd19.210343
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: journal_article
  title: Comparison of Wrist- and Hip-Worn Activity Monitors When Meeting Step Guidelines
  authors: Ryan K Nelson; Kujtim Hasanaj; Gregory Connolly; Lauren Millen; Joshua Muench; Nicole S C Bidolli; Matthew A Preston; Alexander H K Montoye
  year: 2022
  journal: Preventing Chronic Disease
  doi: 10.5888/pcd19.210343
  url: https://doi.org/10.5888/pcd19.210343
  citation: Nelson RK, Hasanaj K, Connolly G, et al. Comparison of wrist- and hip-worn activity monitors when meeting step guidelines. Preventing Chronic Disease. 2022;19:E18. doi:10.5888/pcd19.210343
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC9044899
    doi: 10.5888/pcd19.210343
    titleHash: 2e1fa95bc7e96b596af4dba43a2f8c093c4df5a90dd8ef0f52c3ca0a540484a5
    url: https://doi.org/10.5888/pcd19.210343
  canonicalUrl: https://doi.org/10.5888/pcd19.210343
researchEvidence:
  designKind: cross_sectional
  designLabel: Wrist- versus hip-worn device comparison under step-guideline tasks
  populationLabel: Adults aged 18-65 years with BMI 19-45 kg/m²
  durationLabel: Acute treadmill exercise, treadmill walking, and activities-of-daily-living tasks
  cohortKey: wrist-hip-step-guideline-comparison
  participantCount: 86
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: measurement_validity
whyItMatters: Useful for preventing device-placement bias from becoming a false Daily Step Floor achievement or failure signal.
potentialMurphEndpoints:
- daily steps
- step-count measurement validity
- device/placement bias
- wear-time or multi-day reliability
protocolTakeaway: Step-floor thresholds should be tied to one consistent device and placement when possible.
murphTakeaway: A wrist device may overcount some activities of daily living and undercount some treadmill walking compared with a hip pedometer.
studyDesign: Wrist- versus hip-worn device comparison under step-guideline tasks
modality: Step-count measurement validity / wearable and smartphone tracking
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10-5888-pcd19-210343:measurement-validation
  sourceKey: source_artifact:doi-10.5888-pcd19.210343
  extractedFromArtifactId: art_doi_10_5888_pcd19_210343
  findingKind: measurement_validation
  population: Adults aged 18-65 years with BMI 19-45 kg/m²
  exposure: Fitbit wristband physical activity monitor
  outcome: steps during treadmill exercise; steps during treadmill walking; steps during ADL; total steps toward 10,000-step guideline
  summary: 'In 86 adults, wrist and hip step counts differed by activity type: the wrist device counted fewer treadmill steps but more ADL steps than the hip pedometer.'
  evidenceUse:
  - measurement
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **measurement_validity**.

**Findings:** In 86 adults, wrist and hip step counts differed by activity type: the wrist device counted fewer treadmill steps but more ADL steps than the hip pedometer.

**Why it matters:** Useful for preventing device-placement bias from becoming a false Daily Step Floor achievement or failure signal.

**Potential experiment signals:** Daily steps, step-count measurement validity, device/placement bias, wear-time, and multi-day reliability.

**Protocol takeaway:** Step-floor thresholds should be tied to one consistent device and placement when possible.

**Claim use:** `context-only`.

**Directness boundary:** This is measurement-context evidence for Daily Step Floor. It should not be promoted into a direct claim that the protocol increases steps, improves biomarkers, or causes health outcomes.

**Safety/adverse events:** No adverse-event extraction was made for this source in this batch; it was handled as measurement-validity or implementation-context evidence, not as a safety trial.
