---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:fda-vascepa-prescribing-information-2026-04-25
slug: sources/omega-3-supplementation/fda-vascepa-prescribing-information-2026-04-25
title: 'VASCEPA (icosapent ethyl) capsules, for oral use: prescribing information'
summary: FDA prescribing information PDF for VASCEPA (2019 label version), documenting EPA-only indications, dose, AF/flutter warning, bleeding warning, fish-allergy caution, and antithrombotic monitoring.
status: draft
quality: usable
aliases:
- 'VASCEPA (icosapent ethyl) capsules, for oral use: prescribing information'
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
  title: 'VASCEPA (icosapent ethyl) capsules, for oral use: prescribing information'
  authors: U.S. Food and Drug Administration
  year: 2019
  journal: FDA Drugs@FDA label
  citation: 'U.S. Food and Drug Administration. VASCEPA (icosapent ethyl) capsules, for oral use: prescribing information. Revised December 2019. Accessed for source extraction 2026-04-25.'
  url: https://www.accessdata.fda.gov/drugsatfda_docs/label/2019/202057s035lbl.pdf
researchEvidence:
  designKind: other
  designLabel: FDA prescribing information PDF
  populationLabel: FDA label-indicated statin-treated adults with elevated triglycerides plus established CVD or diabetes/risk factors; severe hypertriglyceridemia adults.
  durationLabel: Daily 4 g/day product label; cited cardiovascular outcomes trial median 4.9 years.
  aggregateRole: primary
  cohortKey: batch-012:fda-vascepa-prescribing-information-2026-04-25
evidenceBucket: safety_adverse_events
whyItMatters: Authoritative FDA label safety boundary for EPA-only prescription therapy; includes fish-allergy and antithrombotic precautions.
potentialMurphEndpoints:
- adverse_event:atrial-fibrillation
- adverse_event:atrial-flutter
- adverse_event:bleeding
- interaction:anticoagulants
- contraindication:fish-allergy
protocolTakeaway: 'Use as safety-only evidence only: The label reports AF/flutter requiring hospitalization in 127 (3%) VASCEPA patients vs 84 (2%) placebo (HR 1.5, 95% CI 1.14-1.98) and bleeding events in 482 (12%) vs 404 (10%), with serious bleeding in 111 (3%) vs 85 (2%).'
murphTakeaway: Authoritative FDA label safety boundary for EPA-only prescription therapy; includes fish-allergy and antithrombotic precautions.
studyDesign: other
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** The label reports AF/flutter requiring hospitalization in 127 (3%) VASCEPA patients vs 84 (2%) placebo (HR 1.5, 95% CI 1.14-1.98) and bleeding events in 482 (12%) vs 404 (10%), with serious bleeding in 111 (3%) vs 85 (2%).

**Why it matters:** Authoritative FDA label safety boundary for EPA-only prescription therapy; includes fish-allergy and antithrombotic precautions.

**Potential experiment signals:** adverse_event:atrial-fibrillation, adverse_event:atrial-flutter, adverse_event:bleeding, interaction:anticoagulants, contraindication:fish-allergy.

**Protocol takeaway:** Use as safety-only evidence only: The label reports AF/flutter requiring hospitalization in 127 (3%) VASCEPA patients vs 84 (2%) placebo (HR 1.5, 95% CI 1.14-1.98) and bleeding events in 482 (12%) vs 404 (10%), with serious bleeding in 111 (3%) vs 85 (2%).

**Claim use:** `safety-only`.

**Population mismatch:** EPA-only prescription therapy, not consumer oral EPA/DHA supplement protocol.

**Limitations:** 2019 FDA PDF explicitly notes it may not be latest approved labeling; use current DailyMed label for current wording.
