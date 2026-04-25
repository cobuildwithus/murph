---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06678698-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct06678698-2026-04-23
title: Acute Effect of Photobiomodulation in Individuals with Hypertension
summary: Hypertension registry compares a single full-body LED panel PBM session with modified ILIB and sham on acute vascular endpoints; it is mainly useful for safety and endpoint boundaries.
status: draft
quality: usable
aliases:
  - NCT06678698
  - UFSaoCarlosPBM
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
  title: Acute Effect of Photobiomodulation in Individuals with Hypertension
  authors: Universidade Federal de Sao Carlos
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Acute Effect of Photobiomodulation in Individuals with Hypertension (NCT06678698). Universidade Federal de Sao Carlos. Registry record accessed 2026-04-23.
  url: https://clinicaltrials.gov/study/NCT06678698
researchEvidence:
  designKind: other
  designLabel: Randomized triple-blind sham-controlled factorial trial protocol
  participantCount: 48
  participantCountKind: reported
  populationLabel: Sedentary or irregularly inactive adults aged 40 to 60 years with hypertension that is difficult to control
  durationLabel: Single intervention session with immediate post-testing and ambulatory blood pressure monitoring
  aggregateRole: primary
  cohortKey: nct06678698-hypertension
evidenceBucket: Emerging disease-specific whole-body PBM variants
whyItMatters: Adds acute vascular endpoints and explicit exclusion-based safety boundaries when a full-body PBM panel is tested in hypertension, but the panel arm is a red-only adjacent variant rather than a direct red-and-near-infrared match.
potentialMurphEndpoints:
  - blood pressure
  - endothelial function
  - arterial stiffness
  - blood nitrite
  - thermography
  - ambulatory blood pressure
protocolTakeaway: Keep as supervised cardiometabolic context and safety-boundary evidence, not as direct efficacy evidence for the target protocol.
murphTakeaway: Useful for endpoint recall and screening boundaries. Do not use it to claim that whole-body red and near-infrared exposure lowers blood pressure.
studyDesign: Randomized triple-blind sham-controlled factorial protocol
modality: Full-body 660 nm LED panel PBM versus modified ILIB and matched sham comparators
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **Emerging disease-specific whole-body PBM variants**.

**Findings:** This hypertension registry randomizes 48 participants across four groups: active full-body panel PBM, panel sham, active modified ILIB, and modified ILIB sham. The full-body panel arm is described as a single 660 nm exposure at 25.34 J/cm² and 42.24 mW/cm², with pre/post assessment of blood pressure, endothelial function, arterial stiffness, blood nitrite, thermography, and ambulatory blood pressure monitoring. The record also contains explicit exclusions around diabetes, BMI over 30, pacemakers, arrhythmias, photosensitive drugs, pregnancy, epilepsy, severe blood pressure on the day, and large body tattoos. Because the panel is red-only and the study mixes in modified ILIB, it should be treated as adjacent-variant context rather than direct red-and-near-infrared protocol evidence.

**Why it matters:** It is one of the clearest cardiometabolic registry records for acute endpoint selection and safety boundaries around whole-body PBM-style exposure in a supervised population.

**Potential experiment signals:** blood pressure, endothelial function, arterial stiffness, blood nitrite, thermography, ambulatory blood pressure

**Protocol takeaway:** Use for acute vascular endpoint planning and safety screening only. Do not promote it into a direct efficacy claim for the target protocol.

**Claim use:** `context-only`.
