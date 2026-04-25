---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:dailymed-icosapent-ethyl-label-2026-04-25
slug: sources/omega-3-supplementation/dailymed-icosapent-ethyl-label-2026-04-25
title: 'DailyMed label: ICOSAPENT ETHYL capsules'
summary: DailyMed prescribing label for generic icosapent ethyl, defining EPA-only prescription dose, indications, AF/flutter hospitalization warning, bleeding warning, fish-allergy caution, and anticoagulant monitoring.
status: draft
quality: usable
aliases:
- 'DailyMed label: ICOSAPENT ETHYL capsules'
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
  title: 'DailyMed label: ICOSAPENT ETHYL capsules'
  authors: National Library of Medicine DailyMed
  year: 2023
  journal: DailyMed
  citation: DailyMed. ICOSAPENT ETHYL capsules prescribing information. Updated March 9, 2023. Accessed for source extraction 2026-04-25.
  url: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e3d38d1d-fbe7-413d-849a-675e7dfa9b0a
researchEvidence:
  designKind: other
  designLabel: Regulatory prescribing label
  populationLabel: Label-indicated adults with severe hypertriglyceridemia; warning evidence includes statin-treated patients with established CVD or diabetes plus risk factors in a cardiovascular outcomes trial.
  durationLabel: Dose label; cardiovascular outcomes trial median 4.9 years for safety warnings.
  aggregateRole: primary
  cohortKey: batch-012:dailymed-icosapent-ethyl-label-2026-04-25
evidenceBucket: safety_adverse_events
whyItMatters: 'EPA-only prescription boundary: AF/flutter, bleeding, fish/shellfish allergy uncertainty, anticoagulant/antiplatelet monitoring, hepatic monitoring.'
potentialMurphEndpoints:
- adverse_event:atrial-fibrillation
- adverse_event:atrial-flutter
- adverse_event:bleeding
- contraindication:fish-allergy
- interaction:anticoagulants
protocolTakeaway: 'Use as safety-only evidence only: Label warns AF/flutter requiring hospitalization occurred in 127 (3%) icosapent ethyl patients vs 84 (2%) placebo patients (HR 1.5, 95% CI 1.14-1.98). Bleeding events occurred in 482 (12%) vs 404 (10%); serious bleeding 111 (3%) vs 85 (2%).'
murphTakeaway: 'EPA-only prescription boundary: AF/flutter, bleeding, fish/shellfish allergy uncertainty, anticoagulant/antiplatelet monitoring, hepatic monitoring.'
studyDesign: other
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** Label warns AF/flutter requiring hospitalization occurred in 127 (3%) icosapent ethyl patients vs 84 (2%) placebo patients (HR 1.5, 95% CI 1.14-1.98). Bleeding events occurred in 482 (12%) vs 404 (10%); serious bleeding 111 (3%) vs 85 (2%).

**Why it matters:** EPA-only prescription boundary: AF/flutter, bleeding, fish/shellfish allergy uncertainty, anticoagulant/antiplatelet monitoring, hepatic monitoring.

**Potential experiment signals:** adverse_event:atrial-fibrillation, adverse_event:atrial-flutter, adverse_event:bleeding, contraindication:fish-allergy, interaction:anticoagulants.

**Protocol takeaway:** Use as safety-only evidence only: Label warns AF/flutter requiring hospitalization occurred in 127 (3%) icosapent ethyl patients vs 84 (2%) placebo patients (HR 1.5, 95% CI 1.14-1.98). Bleeding events occurred in 482 (12%) vs 404 (10%); serious bleeding 111 (3%) vs 85 (2%).

**Claim use:** `safety-only`.

**Population mismatch:** EPA-only prescription product, not mixed EPA+DHA consumer supplement.

**Limitations:** Regulatory label for EPA-only prescription drug, not an oral EPA+DHA dietary-supplement protocol source.
