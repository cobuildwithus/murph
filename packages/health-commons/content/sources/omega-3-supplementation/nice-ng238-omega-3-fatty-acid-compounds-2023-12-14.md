---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-ng238-omega-3-fatty-acid-compounds-2023-12-14
slug: sources/omega-3-supplementation/nice-ng238-omega-3-fatty-acid-compounds-2023-12-14
title: 'Cardiovascular disease: risk assessment and reduction, including lipid modification (NG238)'
summary: NICE lipid-modification guideline used as a restrictive external boundary source for omega-3 compounds, cardiovascular prevention claims, and triglyceride referral thresholds.
status: draft
quality: usable
aliases:
- NICE NG238 omega 3 fatty acid compounds
- NICE cardiovascular disease lipid modification NG238
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: guideline
  title: 'Cardiovascular disease: risk assessment and reduction, including lipid modification (NG238)'
  authors: National Institute for Health and Care Excellence (NICE)
  year: 2023
  journal: NICE guideline
  citation: 'National Institute for Health and Care Excellence. Cardiovascular disease: risk assessment and reduction, including lipid modification (NG238). Published December 14, 2023.'
  url: https://www.nice.org.uk/guidance/ng238/chapter/Recommendations
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline
  populationLabel: People undergoing cardiovascular disease risk assessment or lipid modification in UK care settings
  durationLabel: Guideline; not an intervention follow-up study
  aggregateRole: context
  cohortKey: nice-ng238-lipid-modification
evidenceBucket: clinical_cardiovascular_lipid_boundary
whyItMatters: High-authority negative/restrictive positioning prevents overclaiming of cardiovascular prevention benefits.
potentialMurphEndpoints:
- CVD risk category
- triglycerides
- non-HDL cholesterol
- statin treatment status
- specialist referral thresholds
protocolTakeaway: Do not use this protocol page to claim CVD prevention; treat very high triglycerides or complex lipid results as clinician-supervised.
murphTakeaway: 'This source is a strong boundary check: omega-3 cardiovascular prevention claims should be narrow, sourced, and separated from prescription IPE exceptions.'
studyDesign: Guideline
modality: clinical lipid modification and cardiovascular risk reduction
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **clinical_cardiovascular_lipid_boundary**.

**Findings:**
- NICE recommends against offering omega-3 fatty acid compounds to prevent CVD, with icosapent ethyl as an exception only under separate technology-appraisal conditions.
- NICE also advises that triglyceride results above specified thresholds can require repeat fasting testing, specialist advice, or urgent specialist review.
- The source is used as a context-only boundary and not as direct supplement-efficacy evidence.

**Why it matters:** High-authority negative/restrictive positioning prevents overclaiming of cardiovascular prevention benefits.

**Potential experiment signals:** triglycerides; non-HDL-C; statin status; CVD risk classification; referral thresholds; medication review.

**Protocol takeaway:** Do not use this protocol page to claim CVD prevention; treat very high triglycerides or complex lipid results as clinician-supervised.

**Claim use:** `context-only`.
