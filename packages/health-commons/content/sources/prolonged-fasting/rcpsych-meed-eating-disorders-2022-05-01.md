---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:rcpsych-meed-eating-disorders-2022-05-01
slug: sources/prolonged-fasting/rcpsych-meed-eating-disorders-2022-05-01
title: 'Medical Emergencies in Eating Disorders: Guidance on Recognition and Management (MEED)'
summary: MEED guidance for recognizing and managing medical emergencies in eating disorders, including refeeding risk and urgent referral boundaries.
status: draft
quality: usable
aliases:
- 'MEED 2022 Medical Emergencies in Eating Disorders: Guidance on Re'
- 'Medical Emergencies in Eating Disorders: Guidance on Recognition and Management (MEED)'
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
  kind: guideline
  title: 'Medical Emergencies in Eating Disorders: Guidance on Recognition and Management (MEED)'
  authors: Royal College of Psychiatrists; NHS England; collaborators
  year: 2022
  journal: Royal College of Psychiatrists College Report CR233
  citation: 'Royal College of Psychiatrists; NHS England; collaborators. Medical Emergencies in Eating Disorders: Guidance on Recognition and Management (MEED). Royal College of Psychiatrists College Report CR233. 2022. https://rcpsych.ac.uk/docs/default-source/improving-care/better-mh-policy/college-reports/college-report-cr233-medical-emergencies-in-eating-disorders-%28meed%29-guidance.pdf.'
  url: https://rcpsych.ac.uk/docs/default-source/improving-care/better-mh-policy/college-reports/college-report-cr233-medical-emergencies-in-eating-disorders-%28meed%29-guidance.pdf
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: d4165232af0cc69a8d834b338baac0df5b603b70b450ebec0a55d2612be2bfcb
    url: https://rcpsych.ac.uk/docs/default-source/improving-care/better-mh-policy/college-reports/college-report-cr233-medical-emergencies-in-eating-disorders-%28meed%29-guidance.pdf
  canonicalUrl: https://rcpsych.ac.uk/docs/default-source/improving-care/better-mh-policy/college-reports/college-report-cr233-medical-emergencies-in-eating-disorders-%28meed%29-guidance.pdf
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline
  populationLabel: No participant sample; guideline for eating-disorder medical emergencies in adolescents/adults.
  durationLabel: Emergency recognition and refeeding-risk management pathways.
  aggregateRole: synthesis
  cohortKey: rcpsych-meed-eating-disorders-2022-05-01
  notes:
  - 'Limitations: Eating-disorder emergency guideline; population is adjacent/high-risk, not general wellness fasting.'
  - 'Population mismatch: Eating-disorder medical emergencies and malnutrition differ from low-risk 24–72 hour fasting.'
evidenceBucket: refeeding, electrolytes, and thiamine safety
directnessToProtocol: general_guideline
whyItMatters: Major adjacent eating-disorder emergency guidance; useful for referral/stop boundaries when fasting overlaps with underweight, restriction, purging, bradycardia, ECG, or abnormal labs.
potentialMurphEndpoints:
- biomarker:serum-phosphate
- biomarker:serum-potassium
- biomarker:serum-magnesium
- biomarker:thiamine-status
- biomarker:heart-rhythm
- biomarker:refeeding-syndrome-symptoms
- biomarker:electrolyte-panel
participantSummary: No participant sample; guideline for eating-disorder medical emergencies in adolescents/adults.
interventionOrExposure: Recognition, medical risk assessment, refeeding risk assessment, and urgent care pathways in eating-disorder contexts.
comparatorOrControl: Not applicable or not extracted for this source.
endpoints:
- refeeding symptoms
- phosphate
- potassium
- magnesium
- thiamine
- cardiac symptoms
effectEstimatesOrDirection: MEED guidance is relevant when fasting overlaps with underweight, restriction, purging, bradycardia, ECG abnormalities, abnormal electrolytes, or suspected eating disorder; it supports urgent medical assessment rather than self-guided fasting/refeeding.
adverseEventsOrSafetyNotes: Eating-disorder medical emergency and refeeding-risk boundaries.
limitations: Eating-disorder emergency guideline; population is adjacent/high-risk, not general wellness fasting.
populationMismatch: Eating-disorder medical emergencies and malnutrition differ from low-risk 24–72 hour fasting.
protocolTakeaway: Use as exclusion/referral boundary whenever eating-disorder risk or medical instability is present.
murphTakeaway: 'Important safety page input: fasting protocols should not be used as restriction tools.'
studyDesign: Clinical guideline
modality: Eating-disorder emergency / refeeding safety
claimUse: safety-only
sourceFindings:
- findingId: finding:rcpsych-meed-eating-disorders-2022-05-01-refeeding-safety
  sourceKey: source_artifact:rcpsych-meed-eating-disorders-2022-05-01
  extractedFromArtifactId: art_rcpsych_meed_eating_disorders_2022_05_01
  findingKind: safety
  population: No participant sample; guideline for eating-disorder medical emergencies in adolescents/adults.
  exposure: Recognition, medical risk assessment, refeeding risk assessment, and urgent care pathways in eating-disorder contexts.
  outcome: Eating-disorder medical emergency and refeeding-risk boundaries.
  summary: MEED guidance is relevant when fasting overlaps with underweight, restriction, purging, bradycardia, ECG abnormalities, abnormal electrolytes, or suspected eating disorder; it supports urgent medical assessment rather than self-guided fasting/refeeding.
  evidenceUse:
  - safety
  - adjacent_variant
murphV1Priority: Medium
pdfRightsStatus: permission_required
---

This source is included for **refeeding, electrolytes, and thiamine safety**.

**Findings:** MEED guidance is relevant when fasting overlaps with underweight, restriction, purging, bradycardia, ECG abnormalities, abnormal electrolytes, or suspected eating disorder; it supports urgent medical assessment rather than self-guided fasting/refeeding.

**Why it matters:** Major adjacent eating-disorder emergency guidance; useful for referral/stop boundaries when fasting overlaps with underweight, restriction, purging, bradycardia, ECG, or abnormal labs.

**Potential experiment signals:** biomarker:serum-phosphate, biomarker:serum-potassium, biomarker:serum-magnesium, biomarker:thiamine-status, biomarker:heart-rhythm, biomarker:refeeding-syndrome-symptoms, biomarker:electrolyte-panel.

**Protocol takeaway:** Use as exclusion/referral boundary whenever eating-disorder risk or medical instability is present.

**Claim use:** `safety-only`.
