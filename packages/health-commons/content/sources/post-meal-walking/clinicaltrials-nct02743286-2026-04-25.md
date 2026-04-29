---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct02743286-2026-04-25
slug: sources/post-meal-walking/clinicaltrials-nct02743286-2026-04-25
title: Sedentary Behavior Interrupted—A Pilot Study of Acute Glucoregulatory and Vascular Outcomes
summary: The registry describes a pilot acute sitting-interruption study with standing and walking modalities; it does not provide standalone causal evidence for walking after every meal.
status: draft
quality: usable
aliases:
- NCT02743286
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
  title: Sedentary Behavior Interrupted—A Pilot Study of Acute Glucoregulatory and Vascular Outcomes
  authors: ClinicalTrials.gov / study investigators
  year: 2016
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Sedentary Behavior Interrupted—A Pilot Study of Acute Glucoregulatory and Vascular Outcomes. NCT02743286. Extracted 2026-04-25. https://clinicaltrials.gov/study/NCT02743286
  url: https://clinicaltrials.gov/study/NCT02743286
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT02743286
    url: https://clinicaltrials.gov/study/NCT02743286
  canonicalUrl: https://clinicaltrials.gov/study/NCT02743286
  identityAliases:
  - NCT02743286
researchEvidence:
  designKind: other
  designLabel: Trial registry for an acute randomized sitting-interruption pilot
  participantCount: 10
  participantCountKind: reported
  populationLabel: Sedentary, overweight or obese postmenopausal women in a pilot sitting-interruption study.
  durationLabel: Acute laboratory sitting-interruption sessions; registry companion to a 5-hour published pilot.
  aggregateRole: primary
  cohortKey: cohort:clinicaltrials-nct02743286-2026-04-25
  notes:
  - Registry record rather than a full outcome report
  - Small pilot sample
  - Postmenopausal overweight/obese population
  - Interruptions to sitting rather than walking after every meal
evidenceBucket: sedentary-breaks-standing-micro-walks
whyItMatters: It preserves the registry context for a published pilot comparing standing and walking interruption strategies.
potentialMurphEndpoints:
- Postprandial glucose
- Insulin
- Flow-mediated dilation or vascular function
- Feasibility
protocolTakeaway: Use only to trace the adjacent sitting-interruption trial family; do not use as evidence that walking after every meal works.
murphTakeaway: Useful as provenance for feasibility and modality comparisons, not as an outcome anchor.
studyDesign: trial_registry
modality: standing and walking interruptions to sitting
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **sedentary-breaks-standing-micro-walks**.

**Findings:** The registry describes a pilot acute sitting-interruption study with standing and walking modalities; it does not provide standalone causal evidence for walking after every meal.

**Why it matters:** It preserves the registry context for a published pilot comparing standing and walking interruption strategies.

**Potential experiment signals:** Postprandial glucose, Insulin, Flow-mediated dilation or vascular function, Feasibility.

**Protocol takeaway:** Use only to trace the adjacent sitting-interruption trial family; do not use as evidence that walking after every meal works.

**Claim use:** `context-only`.

## Extraction details

- **Population:** Sedentary, overweight or obese postmenopausal women in a pilot sitting-interruption study.
- **Participant count:** 10 enrolled in the registry-linked pilot; the published companion reported 9 completing all four laboratory conditions.
- **Intervention/exposure:** Standing and walking modalities used to interrupt prolonged sitting in a laboratory postprandial protocol.
- **Comparator/control:** Prolonged sitting control condition in the registered acute crossover/pilot framework.
- **Duration/follow-up:** Acute laboratory sitting-interruption sessions; registry companion to a 5-hour published pilot.
- **Endpoints:** Postprandial glucose, Insulin, Flow-mediated dilation or vascular function, Feasibility
- **Effect estimates or direction:** Registry record only; not treated as an independent efficacy result. The companion pilot is extracted separately as PMID 29190761.
- **Adverse events/safety notes:** No registry adverse-event signal was extracted; registry-level safety reporting is limited.
- **Limitations:** Registry record rather than a full outcome report; Small pilot sample; Postmenopausal overweight/obese population; Interruptions to sitting rather than walking after every meal
- **Population mismatch:** Adjacent variant: sitting-interruption modalities in a narrow postmenopausal pilot population, not an every-meal walking protocol.
- **Artifact candidates and rights:** Rights status in the canonical ledger is `unknown`. Keep source-page metadata and external identifiers; do not add copyrighted publisher PDFs to Git unless redistribution rights are independently confirmed.

## Atomic finding links

- `finding:walking-after-every-meal:clinicaltrials-nct02743286-2026-04-25:001`
