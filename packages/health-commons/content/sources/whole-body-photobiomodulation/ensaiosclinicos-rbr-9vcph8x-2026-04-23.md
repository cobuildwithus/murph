---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ensaiosclinicos-rbr-9vcph8x-2026-04-23
slug: sources/whole-body-photobiomodulation/ensaiosclinicos-rbr-9vcph8x-2026-04-23
title: Application of Whole Body Red Light in patients with Chronic Obstructive Pulmonary Disease
summary: COPD crossover registry uses Joovv Elite whole-body exposure and sham on functional, dyspnea, fatigue, and respiratory-pressure endpoints; results are not yet reported.
status: draft
quality: usable
aliases:
  - RBR-9vcph8x
  - U1111-1305-3461
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
  title: Application of Whole Body Red Light in patients with Chronic Obstructive Pulmonary Disease
  authors: Universidade Federal de São Carlos
  year: 2026
  journal: Brazilian Clinical Trials Registry (REBEC / Ensaios Clínicos)
  citation: Brazilian Clinical Trials Registry (REBEC). Application of Whole Body Red Light in patients with Chronic Obstructive Pulmonary Disease (RBR-9vcph8x). Universidade Federal de São Carlos. Registry record accessed 2026-04-23.
  url: https://ensaiosclinicos.gov.br/rg/RBR-9vcph8x
researchEvidence:
  designKind: other
  designLabel: Randomized single-blind sham-controlled crossover trial protocol
  participantCount: 42
  participantCountKind: reported
  populationLabel: Adults older than 40 years with moderate to severe clinically stable COPD
  durationLabel: Randomized crossover over a 15-day period
  aggregateRole: primary
  cohortKey: rbr-9vcph8x-copd
evidenceBucket: Emerging disease-specific whole-body PBM variants
whyItMatters: Shows the modality moving into COPD with a crossover sham-controlled design and function-heavy endpoints rather than purely symptom scales.
potentialMurphEndpoints:
  - dyspnea
  - lower-limb fatigue
  - five-time sit-to-stand
  - one-minute sit-to-stand
  - two-minute stationary gait
  - maximal inspiratory pressure
  - maximal expiratory pressure
protocolTakeaway: Use as disease-specific implementation and endpoint context only; do not infer COPD benefit without results.
murphTakeaway: This registry is valuable for broadening endpoint recall and safety thinking in symptomatic respiratory populations, but it is not outcome evidence.
studyDesign: Randomized single-blind sham-controlled crossover protocol
modality: Whole-body light exposure with a Joovv Elite system versus sham exposure
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **Emerging disease-specific whole-body PBM variants**.

**Findings:** This COPD registry describes a randomized, single-blind crossover design using a Joovv Elite full-body light system and a sham condition with the equipment turned off plus a red reflector. Outcomes include five-time sit-to-stand, one-minute sit-to-stand, two-minute stationary gait, maximal inspiratory pressure, maximal expiratory pressure, dyspnea, and lower-limb fatigue. The population is adults older than 40 years with moderate to severe, clinically stable COPD who are non-smokers or former smokers and free of recent exacerbation. Because the record is registry-only and the population has clear exertional-risk exclusions, it belongs in context-only use.

**Why it matters:** It extends whole-body PBM recall into a respiratory disease cohort and highlights function-oriented signals that matter outside pain and metabolic use cases.

**Potential experiment signals:** dyspnea, lower-limb fatigue, five-time sit-to-stand, one-minute sit-to-stand, two-minute stationary gait, maximal inspiratory pressure, maximal expiratory pressure

**Protocol takeaway:** Treat as supervised COPD context. It can guide endpoint selection and safety screening, but not efficacy claims.

**Claim use:** `context-only`.
