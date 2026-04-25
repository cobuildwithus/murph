---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ods-omega-3-fatty-acids-health-professional-2026-04-25
slug: sources/omega-3-supplementation/ods-omega-3-fatty-acids-health-professional-2026-04-25
title: 'Omega-3 Fatty Acids: Fact Sheet for Health Professionals'
summary: NIH ODS fact sheet summarizes omega-3 forms, supplement doses, side effects, high-dose safety boundaries, atrial-fibrillation signal, warfarin/anticoagulant monitoring, and pregnancy seafood guidance.
status: draft
quality: usable
aliases:
- NIH Office of Dietary Supplements 2026
- 'Omega-3 Fatty Acids: Fact Sheet for Health Professionals'
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
  kind: web_page
  title: 'Omega-3 Fatty Acids: Fact Sheet for Health Professionals'
  authors: NIH Office of Dietary Supplements
  year: 2026
  journal: NIH Office of Dietary Supplements
  citation: 'NIH Office of Dietary Supplements. Omega-3 Fatty Acids: Fact Sheet for Health Professionals. NIH Office of Dietary Supplements. 2026.'
  url: https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/
researchEvidence:
  designKind: guideline
  designLabel: Health-professional fact sheet
  populationLabel: General population, supplement users, and special populations including pregnancy/lactation and medication users
  durationLabel: Not applicable; living fact sheet
  aggregateRole: primary
  cohortKey: ods-2026-omega3-health-professional
evidenceBucket: safety_adverse_events
whyItMatters: Authoritative public reference for definitions, dose boundaries, common side effects, medication interactions, and pregnancy/seafood context.
potentialMurphEndpoints:
- daily EPA+DHA dose
- GI symptoms
- headache
- odoriferous sweat
- bleeding time
- INR if on warfarin
- atrial fibrillation/flutter watch
protocolTakeaway: 'Use as a general safety reference: ordinary supplements are usually mildly symptomatic, but high-dose use, anticoagulants, and high-CVD-risk AF signals require caution.'
murphTakeaway: The protocol should include dose caps, medication disclosure, anticoagulant/INR monitoring language, and mild GI side-effect logging.
studyDesign: Authoritative health-professional reference
modality: Dietary and supplemental omega-3 fatty acids, including EPA/DHA supplements
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** The fact sheet reports that no UL has been established for omega-3s, notes EFSA and FDA safety conclusions for combined EPA/DHA intakes up to about 5 g/day, lists usually mild side effects, flags a 4 g/day atrial-fibrillation signal in high-CVD-risk trials, and recommends periodic INR monitoring when omega-3 pharmaceuticals are used with anticoagulants.

**Why it matters:** Authoritative public reference for definitions, dose boundaries, common side effects, medication interactions, and pregnancy/seafood context.

**Potential experiment signals:** daily EPA+DHA dose, GI symptoms, headache, odoriferous sweat, bleeding time, INR if on warfarin, atrial fibrillation/flutter watch.

**Protocol takeaway:** Use as a general safety reference: ordinary supplements are usually mildly symptomatic, but high-dose use, anticoagulants, and high-CVD-risk AF signals require caution.

**Claim use:** `safety-only`.

**Directness:** `safety_boundary` for `protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation`.

**Limitations and population mismatch:** Summary source; details depend on the cited reviews, regulatory assessments, and trial populations.
