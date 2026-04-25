---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:dailymed-vascepa-label-2026-04-25
slug: sources/omega-3-supplementation/dailymed-vascepa-label-2026-04-25
title: VASCEPA (Icosapent Ethyl) Capsule Prescribing Information
summary: Current DailyMed label for VASCEPA, an EPA-only prescription product with cardiovascular-risk-reduction and severe-hypertriglyceridemia indications plus AF/flutter, bleeding, fish-allergy, and antithrombotic warnings.
status: draft
quality: usable
aliases:
- VASCEPA (Icosapent Ethyl) Capsule Prescribing Information
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
  title: VASCEPA (Icosapent Ethyl) Capsule Prescribing Information
  authors: National Library of Medicine DailyMed
  year: 2026
  journal: DailyMed
  citation: DailyMed. VASCEPA (icosapent ethyl) capsule prescribing information. Updated March 23, 2026. Accessed for source extraction 2026-04-25.
  url: https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=9c1a2828-1583-4414-ab22-a60480e8e508
researchEvidence:
  designKind: other
  designLabel: Regulatory prescribing label
  populationLabel: Label-indicated statin-treated adults with elevated triglycerides and established cardiovascular disease or diabetes plus risk factors; adults with severe hypertriglyceridemia.
  durationLabel: Daily dose; cardiovascular outcomes trial median 4.9 years.
  aggregateRole: primary
  cohortKey: batch-012:dailymed-vascepa-label-2026-04-25
evidenceBucket: safety_adverse_events
whyItMatters: Label defines EPA-only prescription safety boundaries and should not be used as direct evidence for consumer EPA+DHA supplementation benefits.
potentialMurphEndpoints:
- adverse_event:atrial-fibrillation
- adverse_event:atrial-flutter
- adverse_event:bleeding
- interaction:anticoagulants
- contraindication:fish-allergy
protocolTakeaway: 'Use as safety-only evidence only: AF/flutter requiring hospitalization occurred in 127 (3%) VASCEPA patients vs 84 (2%) placebo (HR 1.5, 95% CI 1.14-1.98); bleeding events occurred in 482 (12%) vs 404 (10%), serious bleeding 111 (3%) vs 85 (2%).'
murphTakeaway: Label defines EPA-only prescription safety boundaries and should not be used as direct evidence for consumer EPA+DHA supplementation benefits.
studyDesign: other
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** AF/flutter requiring hospitalization occurred in 127 (3%) VASCEPA patients vs 84 (2%) placebo (HR 1.5, 95% CI 1.14-1.98); bleeding events occurred in 482 (12%) vs 404 (10%), serious bleeding 111 (3%) vs 85 (2%).

**Why it matters:** Label defines EPA-only prescription safety boundaries and should not be used as direct evidence for consumer EPA+DHA supplementation benefits.

**Potential experiment signals:** adverse_event:atrial-fibrillation, adverse_event:atrial-flutter, adverse_event:bleeding, interaction:anticoagulants, contraindication:fish-allergy.

**Protocol takeaway:** Use as safety-only evidence only: AF/flutter requiring hospitalization occurred in 127 (3%) VASCEPA patients vs 84 (2%) placebo (HR 1.5, 95% CI 1.14-1.98); bleeding events occurred in 482 (12%) vs 404 (10%), serious bleeding 111 (3%) vs 85 (2%).

**Claim use:** `safety-only`.

**Population mismatch:** EPA-only adjacent variant; clinical supervised therapeutic dose.

**Limitations:** Label evidence is from prescription EPA-only product and clinical trial populations, not OTC mixed EPA/DHA users.
