---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04919681-2026-04-25
slug: sources/static-stretching/clinicaltrials-nct04919681-2026-04-25
title: Efficacy of Stretching on Pain Sensitivity
summary: ClinicalTrials.gov record for a six-week stretching and pain-sensitivity study in healthy adults; no results are extracted from the registry record.
status: draft
quality: usable
aliases:
- NCT04919681
- clinicaltrials-nct04919681-2026-04-25
categories:
- static-stretching
relations:
-
  type: related_protocol
  target: protocol_variant:static-stretching/at-home-static-stretching-for-flexibility
-
  type: parent_family
  target: experiment_family:static-stretching
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT04919681
    url: https://clinicaltrials.gov/study/NCT04919681
  canonicalUrl: https://clinicaltrials.gov/study/NCT04919681
source:
  kind: web_page
  title: Efficacy of Stretching on Pain Sensitivity
  authors: ClinicalTrials.gov record NCT04919681
  year: 2021
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov record NCT04919681. Efficacy of Stretching on Pain Sensitivity. ClinicalTrials.gov. 2021.
  url: https://clinicaltrials.gov/study/NCT04919681
researchEvidence:
  designKind: other
  designLabel: Trial registry record for stretching and pain-sensitivity study
  populationLabel: Healthy adults
  durationLabel: Six weeks with follow-up per registry context
  aggregateRole: context
  cohortKey: clinicaltrials-nct04919681-2026-04-25
  notes:
  - 'Comparator/control: Registry details only; no extracted published efficacy result in this artifact.'
  - 'Participant count: not reported in available extraction inputs'
evidenceBucket: home_low_burden_trials
whyItMatters: It keeps preregistered design context separate from outcome evidence.
potentialMurphEndpoints:
- pain sensitivity
- ROM
- adverse-event tracking
protocolTakeaway: Do not cite registry records as efficacy evidence; use them to trace protocol intent and outcomes.
murphTakeaway: Do not cite registry records as efficacy evidence; use them to trace protocol intent and outcomes.
studyDesign: Trial registry record for stretching and pain-sensitivity study
modality: Static stretching / self-administered or home-translatable flexibility work
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **home_low_burden_trials**.

**Findings:** ClinicalTrials.gov record for a six-week stretching and pain-sensitivity study in healthy adults; no results are extracted from the registry record. Registry/protocol source only in this extraction; no efficacy result should be inferred from the registry record.

**Why it matters:** It keeps preregistered design context separate from outcome evidence.

**Potential experiment signals:** pain sensitivity, ROM, adverse-event tracking.

**Protocol takeaway:** Do not cite registry records as efficacy evidence; use them to trace protocol intent and outcomes.

**Claim use:** `context-only`.

## Extraction notes

- **Source kind:** web_page.
- **Study design:** Trial registry record for stretching and pain-sensitivity study.
- **Participant count:** Not reported in the available extraction inputs.
- **Population:** Healthy adults.
- **Intervention or exposure:** Six-week regular stretching protocol assessing regional and distant pain-sensitivity outcomes..
- **Comparator or control:** Registry details only; no extracted published efficacy result in this artifact..
- **Duration or follow-up:** Six weeks with follow-up per registry context.
- **Endpoints:** regional pain sensitivity, distant pain sensitivity, range of motion, safety.
- **Effect estimates or direction where available:** Registry/protocol source only in this extraction; no efficacy result should be inferred from the registry record..
- **Adverse events or safety notes:** No registry adverse-event result extracted..
- **Limitations:** Registry record, not a results paper.; May overlap with the later Støve 2024 single-arm study.; Trial details should be checked directly before protocol synthesis..
- **Population mismatch:** Pain-sensitivity endpoint and registry-only evidence..
- **Directness to At Home Static Stretching For Flexibility:** Direct protocol-context source, but not efficacy evidence..
- **Claim-use boundary:** Use for preregistration/protocol context only..
- **Artifact candidates and rights status:** Candidate metadata only. Rights status: `unknown`. Do not commit copyrighted PDFs unless redistributable rights are verified.
