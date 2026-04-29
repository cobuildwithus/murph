---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:irspen-refeeding-syndrome-acute-care-2013-01-01
slug: sources/prolonged-fasting/irspen-refeeding-syndrome-acute-care-2013-01-01
title: 'Prevention and Treatment of Refeeding Syndrome in the Acute Care Setting: IrSPEN Guideline Document No. 1'
summary: Acute-care guideline covering refeeding-syndrome prevention and treatment, including calories, fluids, electrolytes, and thiamine.
status: draft
quality: usable
aliases:
- Boland K 2013 Prevention and Treatment of Refeeding Syndrome in the A
- 'Prevention and Treatment of Refeeding Syndrome in the Acute Care Setting: IrSPEN Guideline Document No. 1'
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
  title: 'Prevention and Treatment of Refeeding Syndrome in the Acute Care Setting: IrSPEN Guideline Document No. 1'
  authors: Boland K; Solanki D; O'Hanlon C; Irish Society for Clinical Nutrition and Metabolism (IrSPEN)
  year: 2013
  journal: IrSPEN Guideline Document No. 1
  citation: 'Boland K; Solanki D; O''Hanlon C; Irish Society for Clinical Nutrition and Metabolism (IrSPEN). Prevention and Treatment of Refeeding Syndrome in the Acute Care Setting: IrSPEN Guideline Document No. 1. IrSPEN Guideline Document No. 1. 2013. https://irspen.ie/wp-content/uploads/2014/10/IrSPEN_Guideline_Document_No1.pdf.'
  url: https://irspen.ie/wp-content/uploads/2014/10/IrSPEN_Guideline_Document_No1.pdf
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: e064690bbd7de0102c98feac0c5a1b07530f61086e74afb1b34cf338c160f4c0
    url: https://irspen.ie/wp-content/uploads/2014/10/IrSPEN_Guideline_Document_No1.pdf
  canonicalUrl: https://irspen.ie/wp-content/uploads/2014/10/IrSPEN_Guideline_Document_No1.pdf
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline
  populationLabel: No participant sample; acute-care guideline for adults at risk of refeeding syndrome.
  durationLabel: Initial refeeding and early monitoring period in acute-care settings.
  aggregateRole: synthesis
  cohortKey: irspen-refeeding-syndrome-acute-care-2013-01-01
  notes:
  - 'Limitations: Professional guideline; hospital acute-care emphasis; not designed for unsupervised healthy fasting experiments.'
  - 'Population mismatch: Applies to acute-care adults at risk of refeeding syndrome rather than routine low-risk 24–72 hour fasting.'
evidenceBucket: refeeding, electrolytes, and thiamine safety
directnessToProtocol: general_guideline
whyItMatters: Professional acute-care guideline with explicit prevention/treatment orientation and electrolyte/thiamine scope; useful as a safety boundary comparator to NICE and ASPEN.
potentialMurphEndpoints:
- biomarker:serum-phosphate
- biomarker:serum-potassium
- biomarker:serum-magnesium
- biomarker:thiamine-status
- biomarker:fluid-balance
- biomarker:heart-rhythm
- biomarker:refeeding-risk
participantSummary: No participant sample; acute-care guideline for adults at risk of refeeding syndrome.
interventionOrExposure: Acute-care refeeding prevention and treatment guidance, including electrolytes and thiamine.
comparatorOrControl: Not applicable or not extracted for this source.
endpoints:
- phosphate
- potassium
- magnesium
- sodium and fluid balance
- thiamine
- cardiac symptoms
effectEstimatesOrDirection: The guideline recommends identifying high-risk patients and managing early nutrition restart with conservative energy initiation, fluid balance attention, thiamine, and potassium/phosphate/magnesium monitoring and replacement.
adverseEventsOrSafetyNotes: Acute-care refeeding prevention/treatment guardrails.
limitations: Professional guideline; hospital acute-care emphasis; not designed for unsupervised healthy fasting experiments.
populationMismatch: Applies to acute-care adults at risk of refeeding syndrome rather than routine low-risk 24–72 hour fasting.
protocolTakeaway: Use for stop/referral and clinician-supervision boundaries when prolonged restriction or malnutrition features appear.
murphTakeaway: Refeeding electrolyte and thiamine guardrails belong in safety notes and exclusion criteria rather than efficacy claims.
studyDesign: Clinical guideline
modality: Acute-care refeeding safety
claimUse: safety-only
sourceFindings:
- findingId: finding:irspen-refeeding-syndrome-acute-care-2013-01-01-refeeding-safety
  sourceKey: source_artifact:irspen-refeeding-syndrome-acute-care-2013-01-01
  extractedFromArtifactId: art_irspen_refeeding_syndrome_acute_care_2013_01_01
  findingKind: safety
  population: No participant sample; acute-care guideline for adults at risk of refeeding syndrome.
  exposure: Acute-care refeeding prevention and treatment guidance, including electrolytes and thiamine.
  outcome: Acute-care refeeding prevention/treatment guardrails.
  summary: The guideline recommends identifying high-risk patients and managing early nutrition restart with conservative energy initiation, fluid balance attention, thiamine, and potassium/phosphate/magnesium monitoring and replacement.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **refeeding, electrolytes, and thiamine safety**.

**Findings:** The guideline recommends identifying high-risk patients and managing early nutrition restart with conservative energy initiation, fluid balance attention, thiamine, and potassium/phosphate/magnesium monitoring and replacement.

**Why it matters:** Professional acute-care guideline with explicit prevention/treatment orientation and electrolyte/thiamine scope; useful as a safety boundary comparator to NICE and ASPEN.

**Potential experiment signals:** biomarker:serum-phosphate, biomarker:serum-potassium, biomarker:serum-magnesium, biomarker:thiamine-status, biomarker:fluid-balance, biomarker:heart-rhythm, biomarker:refeeding-risk.

**Protocol takeaway:** Use for stop/referral and clinician-supervision boundaries when prolonged restriction or malnutrition features appear.

**Claim use:** `safety-only`.
