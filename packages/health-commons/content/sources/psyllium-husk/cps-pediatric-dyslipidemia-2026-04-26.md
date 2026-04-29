---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:cps-pediatric-dyslipidemia-2026-04-26"
slug: "sources/psyllium-husk/cps-pediatric-dyslipidemia-2026-04-26"
title: "Dyslipidemia in children: Diagnosis, evaluation, and management"
summary: "Canadian Paediatric Society position statement for pediatric dyslipidemia; includes psyllium dosing as pediatric LDL-C adjunct context, not adult self-experiment efficacy evidence."
status: "draft"
quality: "usable"
aliases:
  - "cps-pediatric-dyslipidemia-2026-04-26"
categories:
  - "psyllium-husk"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "guideline"
  title: "Dyslipidemia in children: Diagnosis, evaluation, and management"
  authors: "Khoury M; Bigras JL; Cummings EA; Harris KC; Hegele RA; Henderson M; Morrison KM; St-Pierre J; Wong PW; McCrindle BW; Canadian Paediatric Society"
  year: 2026
  journal: "Canadian Paediatric Society position statement"
  citation: "Khoury M; Bigras JL; Cummings EA; Harris KC; Hegele RA; Henderson M; Morrison KM; St-Pierre J; Wong PW; McCrindle BW; Canadian Paediatric Society. Dyslipidemia in children: Diagnosis, evaluation, and management. Canadian Paediatric Society position statement. 2026. URL: https://cps.ca/en/documents/position/lipid-disorders."
  url: "https://cps.ca/en/documents/position/lipid-disorders"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "d8f76c6ba97a35719cca3c205f8b78d52a601485bbf5d1381f6cd6aa04286f93"
    url: "https://cps.ca/en/documents/position/lipid-disorders"
  canonicalUrl: "https://cps.ca/en/documents/position/lipid-disorders"
researchEvidence:
  designKind: "guideline"
  designLabel: "guideline"
  populationLabel: "Children and adolescents with dyslipidemia, familial hypercholesterolemia, or cardiometabolic risk factors."
  durationLabel: "Guideline context; diet/lifestyle trial commonly framed over months rather than a fixed psyllium intervention duration."
  aggregateRole: "context"
  cohortKey: "cps-pediatric-dyslipidemia-2026-04-26"
  notes:
    - "Participant count is not applicable or not reported for this regulatory/guideline/context source."
evidenceBucket: "Regulatory, guideline, and external health-claim context"
whyItMatters: "Keeps pediatric dosing, escalation, and population boundaries separate from adult self-experiment claims."
potentialMurphEndpoints:
  - "LDL-C"
  - "non-HDL-C"
  - "age group"
  - "clinical escalation threshold"
  - "diet adherence"
protocolTakeaway: "Use only for pediatric boundary context; do not generalize pediatric doses or LDL-C expectations to adults without adult evidence."
murphTakeaway: "This source flags that pediatric dyslipidemia guidance treats psyllium as an adjunct inside broader clinical care."
studyDesign: "guideline"
modality: "psyllium husk / soluble fiber cholesterol context"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:cps-pediatric-dyslipidemia-2026-04-26-pediatric-psyllium-dosing-context"
    sourceKey: "source_artifact:cps-pediatric-dyslipidemia-2026-04-26"
    findingKind: "context"
    population: "Children and adolescents with hypercholesterolemia or dyslipidemia."
    exposure: "Water-soluble psyllium fiber added to pediatric LDL-lowering diet guidance."
    outcome: "LDL-C and pediatric treatment context."
    summary: "The CPS statement treats psyllium as pediatric guideline context, reporting dose-dependent LDL-C lowering of about 5-10% and pediatric dose options of 6 g/day for ages 2-12 and 12 g/day for older children, while noting that effects on CVD risk are unknown."
    evidenceUse:
      - "context"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
extractionNotes:
  batchId: "batch-006"
  evidenceBucket: "Regulatory, guideline, and external health-claim context"
  participantCountNote: "No source-level participant count was applicable or extractable for this context batch unless an included-study count is explicitly listed."
  claimUseBoundary: "context-only; do not use as primary efficacy evidence for the protocol."
populationMismatch: "Pediatric population and clinician-supervised dyslipidemia care differ from the adult cholesterol protocol."
limitations: "Pediatric professional guidance; not an adult trial and not an individual N-of-1 protocol efficacy estimate."
safetyNotes: "Pediatric use requires age-appropriate clinical/nutrition supervision and attention to growth, diet adequacy, and usual psyllium hydration precautions."
---
This source is included for **Regulatory, guideline, and external health-claim context**.

**Findings:** The statement reports dose-dependent LDL-C lowering of roughly 5-10% and suggests pediatric psyllium doses of 6 g/day for ages 2-12 and 12 g/day for those older than 12; the impact on later CVD risk is not known.

**Why it matters:** Keeps pediatric dosing, escalation, and population boundaries separate from adult self-experiment claims.

**Potential experiment signals:** LDL-C, non-HDL-C, age group, clinical escalation threshold, diet adherence

**Protocol takeaway:** Use only for pediatric boundary context; do not generalize pediatric doses or LDL-C expectations to adults without adult evidence.

**Claim use:** `context-only`.

## Extracted source fields

- **Participant count:** Not applicable or not reported for this context source.
- **Participant count kind:** Not applicable/not extracted.
- **Population:** Children and adolescents with dyslipidemia, familial hypercholesterolemia, or cardiometabolic risk factors.
- **Intervention / exposure:** Diet and lifestyle management; water-soluble psyllium fiber considered as an LDL-C adjunct.
- **Comparator / control:** Diet/lifestyle care without psyllium; medication escalation after diet/lifestyle trial where indicated.
- **Duration / follow-up:** Guideline context; diet/lifestyle trial commonly framed over months rather than a fixed psyllium intervention duration.
- **Endpoints:** LDL-C, non-HDL-C, pediatric treatment thresholds, medication sequencing
- **Adverse events / safety notes:** Pediatric use requires age-appropriate clinical/nutrition supervision and attention to growth, diet adequacy, and usual psyllium hydration precautions.
- **Limitations:** Pediatric professional guidance; not an adult trial and not an individual N-of-1 protocol efficacy estimate.
- **Population mismatch:** Pediatric population and clinician-supervised dyslipidemia care differ from the adult cholesterol protocol.
- **Directness to Psyllium Husk For Cholesterol:** general_guideline
- **Artifact / rights notes:** No downloadable artifact candidate required for this batch; rights status open_access.

## Source-owned findings

- `finding:cps-pediatric-dyslipidemia-2026-04-26-pediatric-psyllium-dosing-context` — The CPS statement treats psyllium as pediatric guideline context, reporting dose-dependent LDL-C lowering of about 5-10% and pediatric dose options of 6 g/day for ages 2-12 and 12 g/day for older children, while noting that effects on CVD risk are unknown.
