---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:mayo-hypoxemia-pulse-oximetry
slug: sources/spo2/mayo-hypoxemia-pulse-oximetry
title: "Mayo Clinic hypoxemia reference"
summary: "Patient-facing clinical reference explaining hypoxemia, pulse-oximetry context, arterial blood gas testing, and broad oxygen-saturation ranges."
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
  title: "Low blood oxygen (hypoxemia)"
  authors: "Mayo Clinic Staff"
  year: 2026
  journal: "Mayo Clinic"
  citation: "Mayo Clinic Staff. Low blood oxygen (hypoxemia). Mayo Clinic. Updated 2026-02-20."
  url: https://www.mayoclinic.org/symptoms/hypoxemia/basics/definition/sym-20050930
researchEvidence:
  designKind: guideline
  designLabel: "Patient clinical reference"
  populationLabel: "Patients looking up hypoxemia and blood oxygen context"
  aggregateRole: context
evidenceBucket: "Broad patient-facing reference range and hypoxemia context"
whyItMatters: "Supports the broad sea-level range language and the caution that low readings are clinical context, not a self-diagnosis."
potentialMurphEndpoints:
  - SpO₂ spot checks
  - respiratory symptoms
  - clinical follow-up prompts
murphTakeaway: "Use Mayo's patient-facing framing to keep low SpO₂ safety language clear without turning Murph into a diagnostic tool."
studyDesign: "Patient clinical reference"
modality: "Hypoxemia and oxygen-saturation testing"
murphV1Priority: Medium
---

Mayo Clinic's hypoxemia reference is useful for user-facing language around low oxygen, arterial blood gas testing, and broad pulse-oximeter ranges.

Murph should use this source to keep its copy plain-spoken: low oxygen is a clinical context signal, and a pulse oximeter is an estimate rather than a full diagnosis.
