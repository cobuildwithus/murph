---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:sps-thiamine-refeeding-syndrome-2025-03-11
slug: sources/prolonged-fasting/sps-thiamine-refeeding-syndrome-2025-03-11
title: Prescribing and using thiamine to prevent refeeding syndrome
summary: NHS Specialist Pharmacy Service guidance on prescribing and using thiamine to prevent refeeding syndrome.
status: draft
quality: usable
aliases:
- SPS 2025 Prescribing and using thiamine to prevent refeeding syn
- Prescribing and using thiamine to prevent refeeding syndrome
categories:
- prolonged-fasting
- refeeding-safety
- electrolytes-thiamine
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: web_page
  title: Prescribing and using thiamine to prevent refeeding syndrome
  authors: NHS Specialist Pharmacy Service
  year: 2025
  journal: NHS Specialist Pharmacy Service medicines advice
  citation: NHS Specialist Pharmacy Service. Prescribing and using thiamine to prevent refeeding syndrome. NHS Specialist Pharmacy Service medicines advice. 2025. https://sps.nhs.uk/articles/prescribing-and-using-thiamine-to-prevent-refeeding-syndrome.
  url: https://sps.nhs.uk/articles/prescribing-and-using-thiamine-to-prevent-refeeding-syndrome
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 33a7c29d2bbf1b2be32ccc70685459578fd165c60182542a51a14810a5f50b05
    url: https://sps.nhs.uk/articles/prescribing-and-using-thiamine-to-prevent-refeeding-syndrome
  canonicalUrl: https://sps.nhs.uk/articles/prescribing-and-using-thiamine-to-prevent-refeeding-syndrome
researchEvidence:
  designKind: guideline
  designLabel: Medicines guidance
  populationLabel: No participant sample; NHS medicines advice for patients at refeeding-syndrome risk.
  durationLabel: Before and during early refeeding in at-risk patients.
  aggregateRole: synthesis
  cohortKey: sps-thiamine-refeeding-syndrome-2025-03-11
  notes:
  - 'Limitations: Medicines advice/guidance, not trial evidence; recommendations depend on risk category and clinical context.'
  - 'Population mismatch: Patients at refeeding-syndrome risk are not the same as low-risk 24–72 hour fasting users.'
evidenceBucket: refeeding, electrolytes, and thiamine safety
directnessToProtocol: general_guideline
whyItMatters: Practical medicines-source guidance for route selection and prevention use; pairs well with BAPEN for user-facing supplement boundaries.
potentialMurphEndpoints:
- biomarker:thiamine-status
- biomarker:refeeding-syndrome-symptoms
participantSummary: No participant sample; NHS medicines advice for patients at refeeding-syndrome risk.
interventionOrExposure: Oral, enteral, or intravenous thiamine use before and during refeeding; based on NICE-style risk categories.
comparatorOrControl: Not applicable or not extracted for this source.
endpoints:
- thiamine
- refeeding symptoms
effectEstimatesOrDirection: SPS guidance emphasizes oral/enteral thiamine where clinically appropriate and reserves intravenous thiamine for high/extremely high risk patients when oral or enteral administration is unavailable; it provides practical prescribing context for prevention.
adverseEventsOrSafetyNotes: Thiamine prescribing, route selection, and prevention use in refeeding risk.
limitations: Medicines advice/guidance, not trial evidence; recommendations depend on risk category and clinical context.
populationMismatch: Patients at refeeding-syndrome risk are not the same as low-risk 24–72 hour fasting users.
protocolTakeaway: Use with BAPEN to define thiamine route boundaries and avoid overbroad supplement claims.
murphTakeaway: Practical source for clinician-facing thiamine safety boundaries.
studyDesign: Medicines guidance
modality: Thiamine prescribing for refeeding prevention
claimUse: safety-only
sourceFindings:
- findingId: finding:sps-thiamine-refeeding-syndrome-2025-03-11-refeeding-safety
  sourceKey: source_artifact:sps-thiamine-refeeding-syndrome-2025-03-11
  extractedFromArtifactId: art_sps_thiamine_refeeding_syndrome_2025_03_11
  findingKind: safety
  population: No participant sample; NHS medicines advice for patients at refeeding-syndrome risk.
  exposure: Oral, enteral, or intravenous thiamine use before and during refeeding; based on NICE-style risk categories.
  outcome: Thiamine prescribing, route selection, and prevention use in refeeding risk.
  summary: SPS guidance emphasizes oral/enteral thiamine where clinically appropriate and reserves intravenous thiamine for high/extremely high risk patients when oral or enteral administration is unavailable; it provides practical prescribing context for prevention.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **refeeding, electrolytes, and thiamine safety**.

**Findings:** SPS guidance emphasizes oral/enteral thiamine where clinically appropriate and reserves intravenous thiamine for high/extremely high risk patients when oral or enteral administration is unavailable; it provides practical prescribing context for prevention.

**Why it matters:** Practical medicines-source guidance for route selection and prevention use; pairs well with BAPEN for user-facing supplement boundaries.

**Potential experiment signals:** biomarker:thiamine-status, biomarker:refeeding-syndrome-symptoms.

**Protocol takeaway:** Use with BAPEN to define thiamine route boundaries and avoid overbroad supplement claims.

**Claim use:** `safety-only`.
