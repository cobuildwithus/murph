---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-nutrition-support-cg32-2006-02-22
slug: sources/prolonged-fasting/nice-nutrition-support-cg32-2006-02-22
title: 'Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32)'
summary: NICE CG32 is an authoritative adult nutrition-support guideline with explicit refeeding-risk criteria, calorie initiation boundaries, thiamine/electrolyte supplementation, and monitoring.
status: draft
quality: usable
aliases:
  - 'NICE 2006 Nutrition support for adults: oral nutrition support, e'
  - 'Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32)'
categories:
  - prolonged-fasting
  - refeeding-safety
  - electrolytes-thiamine
relations:
  -
    type: related_protocol
    target: protocol_variant:prolonged-fasting/prolonged-fasting-24-72-hours
  -
    type: parent_family
    target: experiment_family:prolonged-fasting
source:
  kind: guideline
  title: 'Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32)'
  authors: National Institute for Health and Care Excellence (NICE)
  year: 2006
  journal: NICE Clinical Guideline CG32
  citation: 'National Institute for Health and Care Excellence (NICE). Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32). NICE Clinical Guideline CG32. 2006. https://nice.org.uk/guidance/cg32.'
  url: https://nice.org.uk/guidance/cg32
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: ed4bd5fa66bf2ddd7bd47bdd5097b2ce9d41235facdfe3e2bbb055d94df83c03
    url: https://nice.org.uk/guidance/cg32
  canonicalUrl: https://nice.org.uk/guidance/cg32
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline
  populationLabel: No participant sample; NICE adult nutrition-support guideline.
  durationLabel: Initial nutrition support and monitoring after inadequate intake/malnutrition.
  aggregateRole: synthesis
  cohortKey: nice-nutrition-support-cg32-2006-02-22
  notes:
    - 'Limitations: Guideline recommendation base; adult clinical nutrition settings; updated over time only through surveillance rather than a fasting-specific trial.'
    - 'Population mismatch: Malnourished or at-risk adults receiving nutrition support differ from low-risk adults completing a 24–72 hour fast.'
evidenceBucket: refeeding, electrolytes, and thiamine safety
directnessToProtocol: general_guideline
whyItMatters: Authoritative clinical boundary for refeeding risk, electrolytes, thiamine, and monitoring after prolonged restriction.
potentialMurphEndpoints:
  - biomarker:serum-phosphate
  - biomarker:serum-potassium
  - biomarker:serum-magnesium
  - biomarker:thiamine-status
  - biomarker:fluid-balance
  - biomarker:refeeding-syndrome-symptoms
  - biomarker:electrolyte-panel
  - biomarker:refeeding-risk
participantSummary: No participant sample; NICE adult nutrition-support guideline.
interventionOrExposure: Nutrition support, refeeding-risk identification, feeding initiation and monitoring
comparatorOrControl: Not applicable or not extracted for this source.
endpoints:
  - refeeding_syndrome
  - electrolytes
  - thiamine
  - fluid_balance
  - monitoring
effectEstimatesOrDirection: NICE identifies high-risk refeeding features such as very low BMI, substantial weight loss, prolonged negligible intake, or low baseline potassium/phosphate/magnesium; it recommends cautious initial feeding with thiamine and electrolyte support in high-risk patients.
adverseEventsOrSafetyNotes: Refeeding risk criteria and clinical nutrition restart recommendations.
limitations: Guideline recommendation base; adult clinical nutrition settings; updated over time only through surveillance rather than a fasting-specific trial.
populationMismatch: Malnourished or at-risk adults receiving nutrition support differ from low-risk adults completing a 24–72 hour fast.
protocolTakeaway: Use as a hard safety boundary for malnutrition, prolonged negligible intake, abnormal electrolytes, or need for medical refeeding supervision.
murphTakeaway: NICE supports screening for refeeding-risk features before suggesting any post-fast refeed plan.
studyDesign: Clinical guideline
modality: Adult nutrition support / refeeding safety
claimUse: safety-only
sourceFindings:
  -
    findingId: finding:nice-nutrition-support-cg32-2006-02-22-refeeding-safety
    sourceKey: source_artifact:nice-nutrition-support-cg32-2006-02-22
    extractedFromArtifactId: art_nice_nutrition_support_cg32_2006_02_22
    findingKind: safety
    population: No participant sample; NICE adult nutrition-support guideline.
    exposure: Nutrition support, refeeding-risk identification, feeding initiation and monitoring
    outcome: Refeeding risk criteria and clinical nutrition restart recommendations.
    summary: NICE identifies high-risk refeeding features such as very low BMI, substantial weight loss, prolonged negligible intake, or low baseline potassium/phosphate/magnesium; it recommends cautious initial feeding with thiamine and electrolyte support in high-risk patients.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **refeeding, electrolytes, and thiamine safety**.

**Findings:** NICE identifies high-risk refeeding features such as very low BMI, substantial weight loss, prolonged negligible intake, or low baseline potassium/phosphate/magnesium; it recommends cautious initial feeding with thiamine and electrolyte support in high-risk patients.

**Why it matters:** Authoritative clinical boundary for refeeding risk, electrolytes, thiamine, and monitoring after prolonged restriction.

**Potential experiment signals:** biomarker:serum-phosphate, biomarker:serum-potassium, biomarker:serum-magnesium, biomarker:thiamine-status, biomarker:fluid-balance, biomarker:refeeding-syndrome-symptoms, biomarker:electrolyte-panel, biomarker:refeeding-risk.

**Protocol takeaway:** Use as a hard safety boundary for malnutrition, prolonged negligible intake, abnormal electrolytes, or need for medical refeeding supervision.

**Claim use:** `safety-only`.
