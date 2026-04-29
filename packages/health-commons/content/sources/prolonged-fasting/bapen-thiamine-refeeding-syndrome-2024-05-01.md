---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bapen-thiamine-refeeding-syndrome-2024-05-01
slug: sources/prolonged-fasting/bapen-thiamine-refeeding-syndrome-2024-05-01
title: Guidance on thiamine replacement in patients at risk of Refeeding Syndrome
summary: Professional thiamine-replacement guidance for patients at risk of refeeding syndrome, emphasizing route selection and timing before nutrition restart.
status: draft
quality: usable
aliases:
- BAPEN/PENG/BPNG/NPPG 2024 Guidance on thiamine replacement in patients at risk of
- Guidance on thiamine replacement in patients at risk of Refeeding Syndrome
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
  title: Guidance on thiamine replacement in patients at risk of Refeeding Syndrome
  authors: British Pharmaceutical Nutrition Group (BPNG); BAPEN; Parenteral and Enteral Nutrition Group (PENG); Neonatal and Paediatric Pharmacy Group (NPPG)
  year: 2024
  journal: BAPEN/PENG/BPNG/NPPG position guidance
  citation: British Pharmaceutical Nutrition Group (BPNG); BAPEN; Parenteral and Enteral Nutrition Group (PENG); Neonatal and Paediatric Pharmacy Group (NPPG). Guidance on thiamine replacement in patients at risk of Refeeding Syndrome. BAPEN/PENG/BPNG/NPPG position guidance. 2024. https://bapen.org.uk/wp-content/uploads/2024/05/guidance-on-thiamine-replacement-in-refeeding-syndrome.pdf.
  url: https://bapen.org.uk/wp-content/uploads/2024/05/guidance-on-thiamine-replacement-in-refeeding-syndrome.pdf
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 448569830f5284abb6e5cdf3dca324ab9e16cf05f4967d2d6a094980de331e0f
    url: https://bapen.org.uk/wp-content/uploads/2024/05/guidance-on-thiamine-replacement-in-refeeding-syndrome.pdf
  canonicalUrl: https://bapen.org.uk/wp-content/uploads/2024/05/guidance-on-thiamine-replacement-in-refeeding-syndrome.pdf
researchEvidence:
  designKind: guideline
  designLabel: Professional guidance / consensus position statement
  populationLabel: No participant sample; professional guidance document.
  durationLabel: Before and during nutrition restart in high/extremely-high-risk patients.
  aggregateRole: synthesis
  cohortKey: bapen-thiamine-refeeding-syndrome-2024-05-01
  notes:
  - 'Limitations: Guideline/position guidance; dosing and route recommendations are clinical consensus and supply-context dependent rather than fasting trial evidence.'
  - 'Population mismatch: Targets patients at high or extremely high refeeding risk, not generally healthy adults completing a 24–72 hour fast.'
evidenceBucket: refeeding, electrolytes, and thiamine safety
directnessToProtocol: general_guideline
whyItMatters: Focused modern thiamine guidance; useful for distinguishing oral/enteral versus intravenous thiamine boundaries and avoiding overbroad supplement claims.
potentialMurphEndpoints:
- biomarker:thiamine-status
- biomarker:heart-rhythm
- biomarker:refeeding-syndrome-symptoms
participantSummary: No participant sample; professional guidance document.
interventionOrExposure: Thiamine replacement route and timing in the context of refeeding syndrome risk and Pabrinex shortage.
comparatorOrControl: Not applicable or not extracted for this source.
endpoints:
- thiamine
- refeeding symptoms
- cardiac symptoms
effectEstimatesOrDirection: For patients at high or extremely high risk of refeeding syndrome, the guidance emphasizes starting thiamine before nutrition support; it distinguishes oral/enteral use from intravenous use, with IV reserved for situations such as intestinal failure or unavailable oral/enteral administration.
adverseEventsOrSafetyNotes: Thiamine replacement and refeeding-syndrome prevention route boundary.
limitations: Guideline/position guidance; dosing and route recommendations are clinical consensus and supply-context dependent rather than fasting trial evidence.
populationMismatch: Targets patients at high or extremely high refeeding risk, not generally healthy adults completing a 24–72 hour fast.
protocolTakeaway: 'Use as a safety boundary: do not imply routine IV thiamine for wellness fasting; high-risk or symptomatic refeeding concerns need clinical assessment.'
murphTakeaway: Treat thiamine guidance as a guardrail for high-risk refeeding and referral workflows, not as an efficacy claim for fasting.
studyDesign: Professional guidance / consensus position statement
modality: Refeeding thiamine safety
claimUse: safety-only
sourceFindings:
- findingId: finding:bapen-thiamine-refeeding-syndrome-2024-05-01-refeeding-safety
  sourceKey: source_artifact:bapen-thiamine-refeeding-syndrome-2024-05-01
  extractedFromArtifactId: art_bapen_thiamine_refeeding_syndrome_2024_05_01
  findingKind: safety
  population: No participant sample; professional guidance document.
  exposure: Thiamine replacement route and timing in the context of refeeding syndrome risk and Pabrinex shortage.
  outcome: Thiamine replacement and refeeding-syndrome prevention route boundary.
  summary: For patients at high or extremely high risk of refeeding syndrome, the guidance emphasizes starting thiamine before nutrition support; it distinguishes oral/enteral use from intravenous use, with IV reserved for situations such as intestinal failure or unavailable oral/enteral administration.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: permission_required
---

This source is included for **refeeding, electrolytes, and thiamine safety**.

**Findings:** For patients at high or extremely high risk of refeeding syndrome, the guidance emphasizes starting thiamine before nutrition support; it distinguishes oral/enteral use from intravenous use, with IV reserved for situations such as intestinal failure or unavailable oral/enteral administration.

**Why it matters:** Focused modern thiamine guidance; useful for distinguishing oral/enteral versus intravenous thiamine boundaries and avoiding overbroad supplement claims.

**Potential experiment signals:** biomarker:thiamine-status, biomarker:heart-rhythm, biomarker:refeeding-syndrome-symptoms.

**Protocol takeaway:** Use as a safety boundary: do not imply routine IV thiamine for wellness fasting; high-risk or symptomatic refeeding concerns need clinical assessment.

**Claim use:** `safety-only`.
