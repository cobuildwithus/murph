---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct07250698-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct07250698-2026-04-25
title: Glucose Control in Type 2 Diabetes in Pregnancy
summary: ClinicalTrials.gov trial registration for pregnant people with pregestational type 2 diabetes, comparing 20 minutes of walking after breakfast, lunch, and dinner with usual pregnancy physical-activity counseling while using CGM and Fitbit monitoring. No results were extracted.
status: draft
quality: usable
aliases:
- NCT07250698
- Post-prandial walk arm in type 2 diabetes in pregnancy
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
  kind: web_page
  title: Glucose Control in Type 2 Diabetes in Pregnancy
  authors: Eastern Virginia Medical School; Marwan Ma’ayeh; Morgan Scaglione; George Saade
  year: 2025
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Glucose Control in Type 2 Diabetes in Pregnancy. NCT07250698. Accessed 2026-04-25.
  url: https://clinicaltrials.gov/study/NCT07250698
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT07250698
    url: https://clinicaltrials.gov/study/NCT07250698
  canonicalUrl: https://clinicaltrials.gov/study/NCT07250698
  identityAliases:
  - NCT07250698
  - Post-prandial walk arm in type 2 diabetes in pregnancy
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized controlled trial registration
  populationLabel: Pregnant people with known or newly diagnosed type 2 diabetes in pregnancy; singleton gestation; ability to walk 20 minutes required.
  durationLabel: Active participation during pregnancy; protocol snippets describe a primary 2-week CGM window plus chart review through the postpartum period.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct07250698-t2d-pregnancy
evidenceBucket: clinical-supervised-population-boundaries
whyItMatters: This registration is implementation-relevant because it explicitly assigns walking after each main meal in a high-risk pregnancy and type 2 diabetes setting, but it is not an efficacy source without posted outcomes.
potentialMurphEndpoints:
- CGM time in range
- Postprandial glucose
- Insulin dose or medication escalation
- Maternal outcomes
- Neonatal outcomes
- Fitbit adherence
protocolTakeaway: 'Use as a monitored clinical-boundary source: it shows how after-each-meal walking is being studied in type 2 diabetes pregnancy, not that the protocol works in general users.'
murphTakeaway: Pregnancy plus diabetes medication context should be separated from general Murph experiments and routed through clinical supervision.
studyDesign: randomized controlled trial registration
modality: postprandial walking with CGM/Fitbit monitoring
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---
This source is included for **clinical-supervised-population-boundaries**.

Source key for extracted claims on this page: `source_artifact:clinicaltrials-nct07250698-2026-04-25`.

## Findings
- The protocol describes a post-prandial walk arm in which participants are instructed to walk 20 minutes after breakfast, lunch, and dinner.
- Both groups are encouraged to meet pregnancy physical-activity guidance, while the intervention adds meal-timed walking and uses CGM/Fitbit monitoring.
- No efficacy or safety outcome results were extracted from the registration.

## Why it matters
This registration is implementation-relevant because it explicitly assigns walking after each main meal in a high-risk pregnancy and type 2 diabetes setting, but it is not an efficacy source without posted outcomes.

## Potential experiment signals
- CGM time in range
- Postprandial glucose
- Insulin dose or medication escalation
- Maternal outcomes
- Neonatal outcomes
- Fitbit adherence

## Protocol takeaway
Use as a monitored clinical-boundary source: it shows how after-each-meal walking is being studied in type 2 diabetes pregnancy, not that the protocol works in general users.

## Claim use
`context-only`.

## Extraction details

- **Source kind:** trial_registration
- **Study design:** randomized controlled trial registration (Randomized controlled trial registration)
- **Participant count:** Not verified/extracted
- **Population:** Pregnant people with known or newly diagnosed type 2 diabetes in pregnancy; singleton gestation; ability to walk 20 minutes required.
- **Intervention or exposure:** 20 minutes of walking after breakfast, lunch, and dinner.
- **Comparator or control:** Usual physical-activity counseling during pregnancy, without prescribed post-meal walking.
- **Duration or follow-up:** Active participation during pregnancy; protocol snippets describe a primary 2-week CGM window plus chart review through the postpartum period.
- **Endpoints:** CGM metrics such as time in range and postprandial glucose, adherence, insulin or medication outcomes, maternal/neonatal outcomes.
- **Effect estimates or direction:** No efficacy results posted/extracted.
- **Adverse events or safety notes:** No adverse-event results extracted; walking is described in protocol snippets as minimal risk, with inability to walk 20 minutes as an exclusion criterion.
- **Population mismatch:** Pregnant people with type 2 diabetes, likely under medication and maternal-fetal medicine care; not directly applicable to general nonpregnant adults.
- **Directness to Walking After Every Meal:** clinical_supervised
- **Artifact candidates / rights:** Registry/protocol metadata only; no PDF is needed in Git and rights status for protocol files should be checked before reuse. `pdfRightsStatus=unknown`.

## Limitations
- Trial registration/protocol context only.
- Participant count not verified in accessible extracted records.
- Pregnant type 2 diabetes population differs from general wellness users.
- Usual-care comparison also includes exercise guidance.

## Atomic finding links
- `finding:walking-after-every-meal:clinicaltrials-nct07250698-2026-04-25:001`
- `finding:walking-after-every-meal:clinicaltrials-nct07250698-2026-04-25:002`
