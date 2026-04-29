---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02894099-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct02894099-2026-04-25
title: Cardiovascular Risk in Sedentary Elderly
summary: The registry describes a sedentary older-adult activity-break study but does not provide extracted efficacy outcomes for the walking-after-every-meal protocol.
status: draft
quality: usable
aliases:
- NCT02894099
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
  title: Cardiovascular Risk in Sedentary Elderly
  authors: ClinicalTrials.gov / study investigators
  year: 2016
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Cardiovascular Risk in Sedentary Elderly. NCT02894099. Extracted 2026-04-25. https://clinicaltrials.gov/study/NCT02894099
  url: https://clinicaltrials.gov/study/NCT02894099
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT02894099
    url: https://clinicaltrials.gov/study/NCT02894099
  canonicalUrl: https://clinicaltrials.gov/study/NCT02894099
  identityAliases:
  - NCT02894099
researchEvidence:
  designKind: other
  designLabel: Trial registry for sedentary older-adult cardiovascular-risk study
  populationLabel: Sedentary older adults.
  durationLabel: Registry-described acute repeated-condition protocol; extracted notes mention phases separated by washout days.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct02894099-2026-04-25
  notes:
  - Registry record without extracted results
  - Older sedentary population
  - Protocol details and participant count unresolved
  - Not a walking-after-every-meal intervention
evidenceBucket: sedentary-breaks-standing-micro-walks
whyItMatters: Trial-registry lead for older-adult walking-break/dose evidence and possible unpublished details.
potentialMurphEndpoints:
- Postprandial glucose
- Insulin
- Cardiovascular risk markers
- Feasibility
protocolTakeaway: Use only for provenance and gap tracking.
murphTakeaway: Potential lead if future outcome reports are located; not a claim source now.
studyDesign: trial_registry
modality: walking or activity interruptions to sitting
claimUse: context-only
murphV1Priority: Low
pdfRightsStatus: unknown
---
This source is included for **sedentary-breaks-standing-micro-walks**.

**Findings:** The registry describes a sedentary older-adult activity-break study but does not provide extracted efficacy outcomes for the walking-after-every-meal protocol.

**Why it matters:** Trial-registry lead for older-adult walking-break/dose evidence and possible unpublished details.

**Potential experiment signals:** Postprandial glucose, Insulin, Cardiovascular risk markers, Feasibility.

**Protocol takeaway:** Use only for provenance and gap tracking.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Sedentary older adults.
- **Participant count:** Participant count not resolved in the extracted registry record.
- **Intervention/exposure:** Physical-activity interruptions, including walking-break patterns, during prolonged sitting after a standardized meal.
- **Comparator/control:** Prolonged sitting and alternative activity-interruption conditions in the registry protocol.
- **Duration/follow-up:** Registry-described acute repeated-condition protocol; extracted notes mention phases separated by washout days.
- **Endpoints:** Postprandial glucose, Insulin, Cardiovascular risk markers, Feasibility
- **Effect estimates or direction:** Registry record only; no published outcome effect was extracted in this batch.
- **Adverse events/safety notes:** No registry adverse-event signal was extracted; registry-level safety reporting is limited.
- **Limitations:** Registry record without extracted results; Older sedentary population; Protocol details and participant count unresolved; Not a walking-after-every-meal intervention
- **Population mismatch:** Adjacent variant: registry for sedentary-break dose/frequency evidence, not direct protocol evidence.
- **Artifact candidates and rights:** Rights status in the canonical ledger is `unknown`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct02894099-2026-04-25:001`
