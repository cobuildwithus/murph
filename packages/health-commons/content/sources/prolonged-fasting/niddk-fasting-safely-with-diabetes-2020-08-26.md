---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:niddk-fasting-safely-with-diabetes-2020-08-26
slug: sources/prolonged-fasting/niddk-fasting-safely-with-diabetes-2020-08-26
title: Fasting Safely with Diabetes
summary: Government-hosted expert guidance stresses pre-fast clinical planning, glucose testing, medication-risk review, and discouraging fasting for higher-risk diabetes contexts such as markedly elevated A1C, type 1 diabetes w…
status: draft
quality: usable
aliases:
- Fasting Safely with Diabetes
- NIDDK fasting safely with diabetes
categories:
- prolonged-fasting
relations:
- type: related_protocol
  target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
- type: parent_family
  target: experiment_family:prolonged-fasting
source:
  kind: web_page
  title: Fasting Safely with Diabetes
  authors: Grajower MM; National Institute of Diabetes and Digestive and Kidney Diseases
  year: 2020
  journal: NIDDK Diabetes Discoveries & Practice Blog
  citation: Grajower MM; National Institute of Diabetes and Digestive and Kidney Diseases. Fasting Safely with Diabetes. NIDDK Diabetes Discoveries & Practice Blog. 2020.
  url: https://www.niddk.nih.gov/health-information/professionals/diabetes-discoveries-practice/fasting-safely-with-diabetes
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 9ee9d090d994f8b9875d640d9974b14b597e76e42548f376099a0e2ce21e7b35
    url: https://niddk.nih.gov/health-information/professionals/diabetes-discoveries-practice/fasting-safely-with-diabetes
  canonicalUrl: https://www.niddk.nih.gov/health-information/professionals/diabetes-discoveries-practice/fasting-safely-with-diabetes
researchEvidence:
  designKind: expert_protocol
  designLabel: Expert protocol / clinical guidance
  populationLabel: People with diabetes considering religious, intermittent, or other fasting patterns
  durationLabel: Not applicable / synthesis or guidance source
  aggregateRole: primary
  cohortKey: cohort:niddk-fasting-safely-with-diabetes-2020-08-26
evidenceBucket: diabetes, medication, and hypoglycemia safety
whyItMatters: High-quality government-hosted expert discussion; useful for plain-language safety framing and medication-specific testing boundaries.
potentialMurphEndpoints:
- hypoglycemia symptoms
- capillary glucose checks
- rescue carbohydrate need
- hyperglycemia or dehydration symptoms
protocolTakeaway: 'Use as a diabetes medication safety boundary: people with diabetes or glucose-lowering medication exposure need clinician-supervised planning and monitoring rather than a generic fasting protocol.'
murphTakeaway: Community protocols should flag diabetes, insulin, sulfonylureas/meglitinides, SGLT2 inhibitors, recent illness, and poor glycemic control as reasons for medical supervision or exclusion.
studyDesign: Expert protocol / clinical guidance
modality: fasting safety / diabetes medication management
claimUse: safety-only
directnessToProlongedFasting24To72Hours: safety_boundary
populationMismatch: Diabetes clinical-risk population; not metabolically healthy adults pursuing an unsupervised wellness fast.
limitations: Expert interview/web guidance rather than a controlled fasting trial; intended for diabetes safety planning, not efficacy claims for 24–72 hour wellness fasting.
sourceFindings:
- findingId: finding:niddk-fasting-safely-with-diabetes-2020-08-26-fasting-safely-diabetes
  sourceKey: source_artifact:niddk-fasting-safely-with-diabetes-2020-08-26
  extractedFromArtifactId: art_niddk_fasting_safely_with_diabetes_2020_08_26_metadata
  findingKind: safety
  population: People with diabetes considering religious, intermittent, or other fasting patterns
  exposure: Fasting while using diabetes medications or living with diabetes-related dehydration, hyperglycemia, or ketoacidosis risk
  outcome: Medication-related hypoglycemia, hyperglycemia, dehydration, and ketoacidosis safety boundaries
  summary: Government-hosted expert guidance stresses pre-fast clinical planning, glucose testing, medication-risk review, and discouraging fasting for higher-risk diabetes contexts such as markedly elevated A1C, type 1 diabetes with ketoacidosis risk, fever, acute illness, or dehydration concern.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **diabetes, medication, and hypoglycemia safety**.

**Findings:** Government-hosted expert guidance stresses pre-fast clinical planning, glucose testing, medication-risk review, and discouraging fasting for higher-risk diabetes contexts such as markedly elevated A1C, type 1 diabetes with ketoacidosis risk, fever, acute illness, or dehydration concern.

**Why it matters:** High-quality government-hosted expert discussion; useful for plain-language safety framing and medication-specific testing boundaries.

**Potential experiment signals:** hypoglycemia symptoms, capillary glucose checks, rescue carbohydrate need, hyperglycemia or dehydration symptoms.

**Protocol takeaway:** Use as a diabetes medication safety boundary: people with diabetes or glucose-lowering medication exposure need clinician-supervised planning and monitoring rather than a generic fasting protocol.

**Claim use:** `safety-only`.
