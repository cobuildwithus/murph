---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cleveland-clinic-blood-oxygen-level
slug: sources/spo2/cleveland-clinic-blood-oxygen-level
title: "Cleveland Clinic blood oxygen level reference"
summary: "Patient-facing clinical reference explaining pulse-oximeter readings, arterial blood oxygen testing, common causes of low oxygen, and when low home readings warrant clinical contact."
status: field-testing
quality: usable
categories:
  - spo2
  - hypoxemia
  - respiratory
  - clinical-context
relations:

  -
    type: measures
    target: biomarker:blood-oxygen-spo2
source:
  kind: web_page
  title: "Blood Oxygen Level"
  authors: "Cleveland Clinic"
  year: 2022
  journal: "Cleveland Clinic"
  citation: "Cleveland Clinic. Blood Oxygen Level. Last reviewed 2022-02-18."
  url: https://my.clevelandclinic.org/health/diagnostics/22447-blood-oxygen-level
researchEvidence:
  designKind: guideline
  designLabel: "Patient clinical reference"
  populationLabel: "Patients looking up blood oxygen level and pulse-oximetry interpretation"
  aggregateRole: context
evidenceBucket: "Patient-facing safety thresholds and clinical-context caveats"
whyItMatters: "Supports broad home-monitoring caveats: pulse-oximeter values can differ from arterial saturation, chronic conditions and altitude change context, and low readings with symptoms need clinical escalation."
potentialMurphEndpoints:
  - SpO₂ spot checks
  - respiratory symptom notes
  - escalation-context copy
murphTakeaway: "Use this source for conservative safety wording: clinician-specific guidance overrides generic ranges, and symptomatic low readings should not be ignored."
studyDesign: "Patient clinical reference"
modality: "Blood oxygen testing and pulse oximetry"
murphV1Priority: Medium
---

This Cleveland Clinic reference is useful for practical user-facing context: normal ranges are broad, chronic lung disease and high altitude can change expectations, pulse-oximeter readings can differ from arterial saturation, and low home readings may warrant calling a provider or seeking urgent care depending on severity and symptoms.

Murph should not display hard diagnostic rules, but it should make clear that symptomatic low oxygen readings are not a wellness-optimization target; they are a clinical context signal.
