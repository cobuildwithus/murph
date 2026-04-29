---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02180152-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct02180152-2026-04-25
title: Postprandial Walking in Obese Pregnant Women and Perinatal Outcomes
summary: Withdrawn registry for an 8-week pregnancy protocol using 10-minute walks after breakfast, lunch, and dinner on weekdays; actual enrollment was 0 and no results were posted.
status: draft
quality: usable
aliases:
- NCT02180152
- Caminhadas2014
- Postprandial walk pregnancy registry
categories:
- post-meal-walking
relations:
-
  type: related_protocol
  target: protocol_variant:post-meal-walking/walking-after-every-meal
-
  type: parent_family
  target: experiment_family:post-meal-walking
source:
  kind: other
  title: Postprandial Walking in Obese Pregnant Women and Perinatal Outcomes - a Multicenter Randomized Clinical Trial
  authors: Professor Fernando Figueira Integral Medicine Institute; João Guilherme Bezerra Alves; Isabelle EA Pontes
  year: 2014
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Postprandial Walking in Obese Pregnant Women and Perinatal Outcomes - a Multicenter Randomized Clinical Trial. NCT02180152. First posted 2014-07-02; last updated 2020-07-23.
  url: https://clinicaltrials.gov/study/NCT02180152
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT02180152
    url: https://clinicaltrials.gov/study/NCT02180152
  canonicalUrl: https://clinicaltrials.gov/study/NCT02180152
  identityAliases:
  - NCT02180152
  - Caminhadas2014
  - Postprandial walk pregnancy registry
researchEvidence:
  designKind: other
  designLabel: Withdrawn multicenter randomized trial registry record
  populationLabel: Inactive obese pregnant women aged 18–40 years with singleton pregnancy at ≤20 weeks gestation; pre-existing diabetes and prior GDM were excluded.
  durationLabel: 8 weeks planned intervention; trial withdrawn with no enrolled participants.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct02180152-2026-04-25
  notes:
  - Overall status WITHDRAWN; actual enrollment 0.
  - Pregnancy-specific safety and perinatal outcomes were planned.
  - No efficacy or adverse-event results were posted.
  - 'Population mismatch: obese pregnant women, not the general Murph protocol population.'
evidenceBucket: free-living-adherence-registries-external-claims
whyItMatters: This is a direct meal-after-walking protocol in pregnancy, but it is a registry-only safety boundary with no enrolled sample or results.
potentialMurphEndpoints:
- pedometer adherence
- gestational weight gain
- gestational diabetes and preeclampsia incidence
- perinatal outcomes
protocolTakeaway: Use only as pregnancy-safety/context evidence; do not use it to claim benefit from walking after every meal.
murphTakeaway: For pregnancy contexts, clinician clearance and pregnancy-specific contraindications matter more than extrapolating from general walking protocols.
studyDesign: rct
modality: 10-minute postprandial walking after main meals
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: open_access
---
This source is included for **free-living-adherence-registries-external-claims**.

**Findings:** The registry planned 10-minute walks after each main meal Monday through Friday for 8 weeks, with pedometer adherence and pregnancy/perinatal outcomes, but the trial was withdrawn with actual enrollment 0.

**Why it matters:** This is a direct meal-after-walking protocol in pregnancy, but it is a registry-only safety boundary with no enrolled sample or results.

**Potential experiment signals:** pedometer adherence, gestational weight gain, gestational diabetes and preeclampsia incidence, perinatal outcomes.

**Protocol takeaway:** Use only as pregnancy-safety/context evidence; do not use it to claim benefit from walking after every meal.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Inactive obese pregnant women aged 18–40 years, singleton pregnancy, gestational age ≤20 weeks, BMI ≥30 kg/m²; several pregnancy and medical exclusions were listed.

- **Participant count:** 0 actual participants enrolled in the registry record.

- **Intervention/exposure:** Walks lasting 10 minutes after breakfast, lunch, and dinner, Monday to Friday, for 8 weeks; adherence via pedometer daily readings with minimum 1500 steps/day.

- **Comparator/control:** Sedentary pregnant-women/no-intervention arm.

- **Duration/follow-up:** 8 weeks planned; no follow-up results because the trial was withdrawn.

- **Endpoints:** Primary: weight gain after postprandial walks over 8 weeks. Registry summary also planned gestational diabetes, preeclampsia, macrosomia, shoulder dystocia, and fetal death observations.

- **Effect estimates or direction:** No effect estimate; no results posted; actual enrollment 0.

- **Adverse events/safety notes:** Pregnancy-specific exclusions and perinatal outcomes were included; no adverse-event outcomes were posted.

- **Limitations:** Withdrawn trial; actual enrollment 0; registry-only; no efficacy or safety results; pregnancy/obesity population mismatch.

- **Population mismatch:** Pregnancy and obesity-specific registry; direct meal-after-walking schedule but not general adult protocol evidence.

- **Directness to Walking After Every Meal:** direct_protocol

- **Artifact candidates and rights:** ClinicalTrials.gov record is an external registry record; keep metadata/source-page draft only and do not vendor copyrighted third-party materials.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct02180152-2026-04-25:001`
