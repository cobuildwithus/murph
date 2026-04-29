---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
slug: sources/time-restricted-eating/ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
title: Diabetes Management During Ramadan
summary: Accessible clinical reference summarizing diabetes fasting risks, glucose monitoring, medication timing, CKD risk categories, and when to break a fast.
status: draft
quality: usable
aliases:
- Diabetes Management During Ramadan
- source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
categories:
- time-restricted-eating
relations:
- type: related_protocol
  target: protocol_variant:time-restricted-eating/time-restricted-eating-18-6
- type: parent_family
  target: experiment_family:time-restricted-eating
source:
  kind: guideline
  title: Diabetes Management During Ramadan
  authors: Shaikh S; Latheef A; Razi SM; Khan SA; Sahay R; Kalra S
  year: 2022
  journal: Endotext / NCBI Bookshelf
  citation: 'Shaikh S, Latheef A, Razi SM, Khan SA, Sahay R, Kalra S. Diabetes Management During Ramadan. In: Endotext. NCBI Bookshelf. Updated May 18, 2022.'
  url: https://www.ncbi.nlm.nih.gov/books/NBK581875/
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    titleHash: a71562d9a07a5c1d837861fcec8f53137cf73c9abb704a36db5d1895dfcc9f34
    url: https://www.ncbi.nlm.nih.gov/books/NBK581875/
  canonicalUrl: https://www.ncbi.nlm.nih.gov/books/NBK581875/
researchEvidence:
  designKind: guideline
  designLabel: Guideline
  populationLabel: People with diabetes considering Ramadan fasting.
  durationLabel: Clinical reference; Ramadan fasting context.
  aggregateRole: primary
  cohortKey: cohort:batch-009-ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
evidenceBucket: Guidelines and external safety context
whyItMatters: It offers practical safety boundaries that map directly to self-experiment exclusion/off-ramp logic.
potentialMurphEndpoints:
- SMBG/CGM values
- break-fast events
- hypoglycemia symptoms
- hydration symptoms
- medication adjustments
protocolTakeaway: Use as safety-only support for medication review, glucose monitoring, and stop-fast thresholds in diabetes risk groups.
murphTakeaway: Fasting-window protocols should instruct diabetes users to break the fast and seek care for clinically unsafe glucose readings or acute illness.
studyDesign: guideline
modality: Ramadan diabetes clinical reference
claimUse: safety-only
sourceFindings:
- findingId: finding:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-diabetes-fasting-complications-01
  sourceKey: source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
  extractedFromArtifactId: art-ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-metadata
  findingKind: safety
  population: People with diabetes
  exposure: Ramadan fasting
  outcome: Diabetes fasting complications
  summary: The chapter describes increased risks of hyperglycemia, hypoglycemia, cardiovascular or renal complications during Ramadan fasting and recommends integrated pre-, during-, and post-Ramadan care.
  evidenceUse:
  - safety
  - context
- findingId: finding:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-hypoglycemia-risk-02
  sourceKey: source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
  extractedFromArtifactId: art-ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-metadata
  findingKind: safety
  population: People with diabetes using insulin or sulfonylureas
  exposure: Fasting with glucose-lowering medications
  outcome: Hypoglycemia risk
  summary: The chapter identifies sulfonylureas and insulin as medication classes associated with hypoglycemia risk during fasting and recommends prefast medication review and adjustment.
  evidenceUse:
  - safety
- findingId: finding:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-break-fast-criteria-03
  sourceKey: source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
  extractedFromArtifactId: art-ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-metadata
  findingKind: safety
  population: People with diabetes monitoring glucose during fasting
  exposure: Blood glucose thresholds during a fast
  outcome: Break-fast criteria
  summary: The chapter advises breaking the fast for blood glucose below 70 mg/dL, above 300 mg/dL, symptoms, dehydration, or acute illness, with closer checks for 70-90 mg/dL.
  evidenceUse:
  - safety
  - measurement
- findingId: finding:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-renal-risk-categories-04
  sourceKey: source_artifact:ncbi-bookshelf-diabetes-management-ramadan-2022-03-04
  extractedFromArtifactId: art-ncbi-bookshelf-diabetes-management-ramadan-2022-03-04-metadata
  findingKind: safety
  population: People with diabetes and CKD
  exposure: Fasting with kidney disease
  outcome: Renal risk categories
  summary: The chapter flags CKD stage 3 as high risk and CKD stages 4-5, dialysis, or transplant as very-high/high risk in Ramadan fasting guidance.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **Guidelines and external safety context**.

**Findings:** The chapter describes increased risks of hyperglycemia, hypoglycemia, cardiovascular or renal complications during Ramadan fasting and recommends integrated pre-, during-, and post-Ramadan care. The chapter identifies sulfonylureas and insulin as medication classes associated with hypoglycemia risk during fasting and recommends prefast medication review and adjustment. The chapter advises breaking the fast for blood glucose below 70 mg/dL, above 300 mg/dL, symptoms, dehydration, or acute illness, with closer checks for 70-90 mg/dL. The chapter flags CKD stage 3 as high risk and CKD stages 4-5, dialysis, or transplant as very-high/high risk in Ramadan fasting guidance.

**Why it matters:** It offers practical safety boundaries that map directly to self-experiment exclusion/off-ramp logic.

**Potential experiment signals:** SMBG/CGM values; break-fast events; hypoglycemia symptoms; hydration symptoms; medication adjustments.

**Protocol takeaway:** Use as safety-only support for medication review, glucose monitoring, and stop-fast thresholds in diabetes risk groups.

**Claim use:** `safety-only`.
