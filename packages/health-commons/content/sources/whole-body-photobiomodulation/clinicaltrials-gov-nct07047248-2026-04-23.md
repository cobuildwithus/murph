---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct07047248-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct07047248-2026-04-23
title: "Short- and Long-Term Effects of Whole-Body Photobiomodulation in Type II Diabetes Patients: A Protocol for a Controlled Clinical Trial (PBM)"
summary: Triple-blind placebo-controlled diabetes registry plans 20-minute whole-body PBM versus placebo with 3- and 6-month glucose and sleep follow-up; it is useful for implementation recall, not outcome claims.
status: draft
quality: usable
aliases:
  - NCT07047248
categories:
  - whole-body-photobiomodulation
relations:

  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: web_page
  title: "Short- and Long-Term Effects of Whole-Body Photobiomodulation in Type II Diabetes Patients: A Protocol for a Controlled Clinical Trial (PBM)"
  authors: University of Malaga
  year: 2026
  journal: ClinicalTrials.gov
  citation: "ClinicalTrials.gov. Short- and Long-Term Effects of Whole-Body Photobiomodulation in Type II Diabetes Patients: A Protocol for a Controlled Clinical Trial (PBM) (NCT07047248). University of Malaga. Registry record accessed 2026-04-23."
  url: https://clinicaltrials.gov/study/NCT07047248
researchEvidence:
  designKind: other
  designLabel: Randomized triple-blind placebo-controlled parallel trial protocol
  participantCount: 44
  participantCountKind: reported
  populationLabel: Adults aged 30 to 70 years with stable type 2 diabetes and HbA1c 6.5% to 10%
  durationLabel: 20-minute intervention sessions with follow-up at 3 and 6 months
  aggregateRole: primary
  cohortKey: nct07047248-type2-diabetes
evidenceBucket: Emerging disease-specific whole-body PBM variants
whyItMatters: Shows that whole-body PBM is being operationalized as a longer-term metabolic intervention with placebo control, glycemic endpoints, and sleep-quality follow-up in a diabetes cohort.
potentialMurphEndpoints:
  - fasting glucose
  - HbA1c
  - sleep quality
  - medication stability
  - adherence
protocolTakeaway: Track as a planned placebo-controlled diabetes variant with longer follow-up; do not infer benefit before results exist.
murphTakeaway: Use for implementation recall, endpoint planning, and safety boundaries only. It should not be cited as evidence that the protocol improves glucose control.
studyDesign: Randomized triple-blind placebo-controlled parallel protocol
modality: Whole-body photobiomodulation with a NovoTHOR device versus placebo whole-body light exposure
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **Emerging disease-specific whole-body PBM variants**.

**Findings:** This registry plans a 44-participant, triple-blind, placebo-controlled whole-body PBM trial in adults with stable type 2 diabetes. The active arm uses a NovoTHOR whole-body session for 20 minutes, matched against a 20-minute placebo condition. Primary outcomes are fasting glucose and HbA1c at 3 and 6 months, with Pittsburgh Sleep Quality Index as a secondary outcome. Because this is a registry protocol with no posted results, it should stay in context-only use.

The registry also contributes safety-screening context because it constrains diabetes medication status and excludes insulin dependence, high fasting glucose, pacemaker use, cognitive deficits, neurologic or pulmonary disease, and active cancer treatment.

**Why it matters:** It helps Murph track how disease-specific teams are translating whole-body PBM into longer follow-up metabolic studies rather than only acute or symptom-based use cases.

**Potential experiment signals:** fasting glucose, HbA1c, sleep quality, medication stability, adherence

**Protocol takeaway:** Treat as planned implementation evidence, not efficacy evidence. It is relevant for endpoint and follow-up design in supervised diabetes settings.

**Claim use:** `context-only`.
