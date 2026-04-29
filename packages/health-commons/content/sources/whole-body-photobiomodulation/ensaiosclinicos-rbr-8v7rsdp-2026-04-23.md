---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ensaiosclinicos-rbr-8v7rsdp-2026-04-23
slug: sources/whole-body-photobiomodulation/ensaiosclinicos-rbr-8v7rsdp-2026-04-23
title: Effects of Whole-body LED on blood glucose levels in men with Type 2 Diabetes
summary: Dose-response diabetes registry specifies 10-, 20-, and 30-minute 850 nm whole-body PBM tiers with serial glucose tracking to 24 hours; it is registry-only and internally inconsistent on sample size.
status: draft
quality: usable
aliases:
  - RBR-8v7rsdp
  - U1111-1326-2162
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
  title: Effects of Whole-body LED on blood glucose levels in men with Type 2 Diabetes
  authors: Departamento de Fisioterapia
  year: 2026
  journal: Brazilian Clinical Trials Registry (REBEC / Ensaios Clínicos)
  citation: Brazilian Clinical Trials Registry (REBEC). Effects of Whole-body LED on blood glucose levels in men with Type 2 Diabetes (RBR-8v7rsdp). Departamento de Fisioterapia. Registry record accessed 2026-04-23.
  url: https://ensaiosclinicos.gov.br/rg/RBR-8v7rsdp
researchEvidence:
  designKind: other
  designLabel: Randomized double-blind sham-controlled dose-response trial protocol
  participantCount: 44
  participantCountKind: reported
  populationLabel: Men aged 40 to 70 years with type 2 diabetes, low physical activity, oral hypoglycemic use, and BMI up to 34.9 kg/m²
  durationLabel: Two-week protocol with acute glucose follow-up through 24 hours after intervention
  aggregateRole: primary
  cohortKey: rbr-8v7rsdp-type2-diabetes-men
evidenceBucket: Emerging disease-specific whole-body PBM variants
whyItMatters: Fills a major dose-response gap with explicit 850 nm whole-body PBM exposure times, fluences, and serial glucose monitoring windows in a supervised diabetes cohort.
potentialMurphEndpoints:
  - fasting capillary glucose
  - post-meal glucose
  - 3-hour glucose
  - 6-hour glucose
  - 12-hour glucose
  - 24-hour glucose
protocolTakeaway: Use for dose and endpoint timing ideas only. It is a near-infrared-only supervised registry, not direct efficacy evidence for the target combined red-and-near-infrared protocol.
murphTakeaway: This is one of the most detailed dosing records in the batch, but it remains registry-only and population-mismatched. Keep it in context-only use.
studyDesign: Randomized double-blind sham-controlled four-arm dose-response protocol
modality: Whole-body 850 nm LED photobiomodulation with sham control
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Emerging disease-specific whole-body PBM variants**.

**Findings:** This diabetes registry lays out four groups with 10-, 20-, and 30-minute effective whole-body PBM doses plus a 30-minute sham condition, using 850 nm light at 36.13 mW/cm² with fluences of 10.83, 21.67, and 32.50 J/cm². Glucose is measured fasting, one hour after a standardized meal, three hours after intervention, and again at 6, 12, and 24 hours after photobiomodulation. The protocol includes a 24-hour hold on oral hypoglycemics before intervention and excludes fasting glucose above 200 mg/dL, insulin dependence, pacemaker use, cognitive deficits, neurologic or pulmonary disease, and active cancer treatment. The key limit is that this is a registry-only, male-only, 850 nm near-infrared-only variant with inconsistent sample-size reporting.

**Why it matters:** It is unusually specific about dose, fluence, timing, and acute glucose follow-up, which makes it valuable for protocol-boundary mapping even before outcomes exist.

**Potential experiment signals:** fasting capillary glucose, post-meal glucose, 3-hour glucose, 6-hour glucose, 12-hour glucose, 24-hour glucose

**Protocol takeaway:** Treat as an adjacent near-infrared-only dosing record. It can inform dose exploration and endpoint timing, but not efficacy claims.

**Claim use:** `context-only`.
