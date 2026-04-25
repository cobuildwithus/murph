---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:dailymed-omega-3-acid-ethyl-esters-label-2026-04-25
slug: sources/omega-3-supplementation/dailymed-omega-3-acid-ethyl-esters-label-2026-04-25
title: 'Omega-3-acid ethyl esters capsule, liquid filled: prescribing information'
summary: DailyMed label for generic omega-3-acid ethyl esters (EPA+DHA) for severe hypertriglyceridemia, including LDL-C, fish-allergy, recurrent AF/flutter, GI adverse-event, postmarketing hemorrhagic-diathesis, and anticoagulant-monitoring language.
status: draft
quality: usable
aliases:
- 'Omega-3-acid ethyl esters capsule, liquid filled: prescribing information'
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
  kind: other
  title: 'Omega-3-acid ethyl esters capsule, liquid filled: prescribing information'
  authors: National Library of Medicine DailyMed
  year: 2024
  journal: DailyMed
  citation: 'DailyMed. Omega-3-acid ethyl esters capsule, liquid filled: prescribing information. Updated February 18, 2024. Accessed for source extraction 2026-04-25.'
  url: https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=730e47e0-d2eb-46c5-8be7-1d0cd5b4a6fa
researchEvidence:
  designKind: other
  designLabel: Regulatory prescribing label
  populationLabel: Adults with severe hypertriglyceridemia; AF warning references 663 subjects with symptomatic paroxysmal or persistent AF.
  durationLabel: 4 g/day label dose; recurrent AF warning trial used 8 g/day for 7 days then 4 g/day for 23 weeks.
  aggregateRole: primary
  cohortKey: batch-012:dailymed-omega-3-acid-ethyl-esters-label-2026-04-25
evidenceBucket: safety_adverse_events
whyItMatters: Current U.S. label boundary for EPA+DHA ethyl ester prescription products.
potentialMurphEndpoints:
- adverse_event:atrial-fibrillation
- adverse_event:atrial-flutter
- biomarker:ldl-c
- symptom:gastrointestinal-adverse-effects
- interaction:anticoagulants
- contraindication:fish-allergy
protocolTakeaway: 'Use as safety-only evidence only: Label-cited recurrent AF trial reported combined HR 1.25 (95% CI 1.00-1.40) for symptomatic AF/flutter recurrence; the label states clinical significance is uncertain and product is not indicated for AF/flutter. It also states LDL-C may increase and anticoagulant monitoring is advised.'
murphTakeaway: Current U.S. label boundary for EPA+DHA ethyl ester prescription products.
studyDesign: other
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** Label-cited recurrent AF trial reported combined HR 1.25 (95% CI 1.00-1.40) for symptomatic AF/flutter recurrence; the label states clinical significance is uncertain and product is not indicated for AF/flutter. It also states LDL-C may increase and anticoagulant monitoring is advised.

**Why it matters:** Current U.S. label boundary for EPA+DHA ethyl ester prescription products.

**Potential experiment signals:** adverse_event:atrial-fibrillation, adverse_event:atrial-flutter, biomarker:ldl-c, symptom:gastrointestinal-adverse-effects, interaction:anticoagulants, contraindication:fish-allergy.

**Protocol takeaway:** Use as safety-only evidence only: Label-cited recurrent AF trial reported combined HR 1.25 (95% CI 1.00-1.40) for symptomatic AF/flutter recurrence; the label states clinical significance is uncertain and product is not indicated for AF/flutter. It also states LDL-C may increase and anticoagulant monitoring is advised.

**Claim use:** `safety-only`.

**Population mismatch:** Prescription EPA+DHA ethyl ester product, not OTC supplement evidence.

**Limitations:** Prescription label; product-specific warnings and high-dose therapeutic context.
