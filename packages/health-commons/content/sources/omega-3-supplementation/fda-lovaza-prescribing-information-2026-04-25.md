---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-lovaza-prescribing-information-2026-04-25
slug: sources/omega-3-supplementation/fda-lovaza-prescribing-information-2026-04-25
title: 'LOVAZA (omega-3-acid ethyl esters) capsules: prescribing information'
summary: FDA prescribing information PDF for LOVAZA, documenting EPA+DHA ethyl ester indication, 4 g/day dose, LDL-C and liver-enzyme monitoring, fish-allergy caution, recurrent AF/flutter warning, GI adverse effects, and anticoagulant monitoring.
status: draft
quality: usable
aliases:
- 'LOVAZA (omega-3-acid ethyl esters) capsules: prescribing information'
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
  title: 'LOVAZA (omega-3-acid ethyl esters) capsules: prescribing information'
  authors: U.S. Food and Drug Administration
  year: 2019
  journal: FDA Drugs@FDA label
  citation: 'U.S. Food and Drug Administration. LOVAZA (omega-3-acid ethyl esters) capsules: prescribing information. Revised April 2019. Accessed for source extraction 2026-04-25.'
  url: https://www.accessdata.fda.gov/drugsatfda_docs/label/2019/021654s043lbl.pdf
researchEvidence:
  designKind: guideline
  designLabel: FDA prescribing information PDF
  populationLabel: Adults with severe hypertriglyceridemia; recurrent AF warning trial enrolled 663 subjects with symptomatic paroxysmal or persistent AF.
  durationLabel: 4 g/day product label; recurrent AF warning trial 8 g/day for 7 days then 4 g/day for 23 weeks.
  aggregateRole: primary
  cohortKey: batch-012:fda-lovaza-prescribing-information-2026-04-25
evidenceBucket: safety_adverse_events
whyItMatters: Regulatory boundary source for prescription EPA+DHA ethyl esters relative to dietary supplements.
potentialMurphEndpoints:
- adverse_event:atrial-fibrillation
- adverse_event:atrial-flutter
- biomarker:ldl-c
- symptom:gastrointestinal-adverse-effects
- interaction:anticoagulants
- contraindication:fish-allergy
protocolTakeaway: 'Use as safety-only evidence only: FDA label warns of possible association with more frequent symptomatic AF/flutter recurrence, particularly in first 2-3 months. In the cited trial, combined strata HR was 1.25 (95% CI 1.00-1.40).'
murphTakeaway: Regulatory boundary source for prescription EPA+DHA ethyl esters relative to dietary supplements.
studyDesign: guideline
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** FDA label warns of possible association with more frequent symptomatic AF/flutter recurrence, particularly in first 2-3 months. In the cited trial, combined strata HR was 1.25 (95% CI 1.00-1.40).

**Why it matters:** Regulatory boundary source for prescription EPA+DHA ethyl esters relative to dietary supplements.

**Potential experiment signals:** adverse_event:atrial-fibrillation, adverse_event:atrial-flutter, biomarker:ldl-c, symptom:gastrointestinal-adverse-effects, interaction:anticoagulants, contraindication:fish-allergy.

**Protocol takeaway:** Use as safety-only evidence only: FDA label warns of possible association with more frequent symptomatic AF/flutter recurrence, particularly in first 2-3 months. In the cited trial, combined strata HR was 1.25 (95% CI 1.00-1.40).

**Claim use:** `safety-only`.

**Population mismatch:** Prescription EPA+DHA ethyl ester therapy, not over-the-counter supplement protocol.

**Limitations:** 2019 PDF may not be latest approved label; use current DailyMed for latest wording.
