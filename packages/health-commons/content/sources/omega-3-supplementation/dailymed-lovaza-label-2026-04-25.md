---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:dailymed-lovaza-label-2026-04-25
slug: sources/omega-3-supplementation/dailymed-lovaza-label-2026-04-25
title: 'DailyMed label: LOVAZA (omega-3-acid ethyl esters) capsules'
summary: DailyMed prescribing label for LOVAZA, an EPA+DHA ethyl ester prescription product for severe hypertriglyceridemia, including LDL-C monitoring, fish-allergy caution, recurrent AF/flutter warning, GI adverse events, and anticoagulant monitoring.
status: draft
quality: usable
aliases:
- 'DailyMed label: LOVAZA (omega-3-acid ethyl esters) capsules'
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
  title: 'DailyMed label: LOVAZA (omega-3-acid ethyl esters) capsules'
  authors: National Library of Medicine DailyMed
  year: 2026
  journal: DailyMed
  citation: DailyMed. LOVAZA (omega-3-acid ethyl esters) capsules prescribing information. Updated March 9, 2026. Accessed for source extraction 2026-04-25.
  url: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=21cfa4ce-0b05-47ed-b268-339eb1b83b75
researchEvidence:
  designKind: other
  designLabel: Regulatory prescribing label
  populationLabel: Adults with severe hypertriglyceridemia; AF warning references 663 subjects with symptomatic paroxysmal or persistent AF.
  durationLabel: Labeled daily dose; recurrent AF trial used 8 g/day for 7 days then 4 g/day for 23 weeks.
  aggregateRole: primary
  cohortKey: batch-012:dailymed-lovaza-label-2026-04-25
evidenceBucket: safety_adverse_events
whyItMatters: EPA+DHA prescription label highlights LDL-C monitoring, recurrent AF/flutter warning, common GI adverse effects, fish/shellfish allergy caution, and coagulation monitoring.
potentialMurphEndpoints:
- adverse_event:atrial-fibrillation
- adverse_event:atrial-flutter
- biomarker:ldl-c
- symptom:gastrointestinal-adverse-effects
- interaction:anticoagulants
- contraindication:fish-allergy
protocolTakeaway: 'Use as safety-only evidence only: In the label-cited recurrent AF trial, combined paroxysmal/persistent strata had HR 1.25 (95% CI 1.00-1.40) for recurrent symptomatic AF/flutter with LOVAZA vs placebo; clinical significance was described as uncertain. The label states LOVAZA can increase LDL-C and is not indicated for AF/flutter treatment.'
murphTakeaway: EPA+DHA prescription label highlights LDL-C monitoring, recurrent AF/flutter warning, common GI adverse effects, fish/shellfish allergy caution, and coagulation monitoring.
studyDesign: other
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** In the label-cited recurrent AF trial, combined paroxysmal/persistent strata had HR 1.25 (95% CI 1.00-1.40) for recurrent symptomatic AF/flutter with LOVAZA vs placebo; clinical significance was described as uncertain. The label states LOVAZA can increase LDL-C and is not indicated for AF/flutter treatment.

**Why it matters:** EPA+DHA prescription label highlights LDL-C monitoring, recurrent AF/flutter warning, common GI adverse effects, fish/shellfish allergy caution, and coagulation monitoring.

**Potential experiment signals:** adverse_event:atrial-fibrillation, adverse_event:atrial-flutter, biomarker:ldl-c, symptom:gastrointestinal-adverse-effects, interaction:anticoagulants, contraindication:fish-allergy.

**Protocol takeaway:** Use as safety-only evidence only: In the label-cited recurrent AF trial, combined paroxysmal/persistent strata had HR 1.25 (95% CI 1.00-1.40) for recurrent symptomatic AF/flutter with LOVAZA vs placebo; clinical significance was described as uncertain. The label states LOVAZA can increase LDL-C and is not indicated for AF/flutter treatment.

**Claim use:** `safety-only`.

**Population mismatch:** Prescription EPA+DHA ethyl ester severe-hypertriglyceridemia product, not over-the-counter oral EPA/DHA self-experimentation.

**Limitations:** Prescription ethyl ester product at 4 g/day; not a dietary supplement label and not a general cardiovascular-outcome benefit source.
