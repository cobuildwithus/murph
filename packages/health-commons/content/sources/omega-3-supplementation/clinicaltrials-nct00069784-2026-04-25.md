---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00069784-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct00069784-2026-04-25
title: 'The ORIGIN Trial: Outcome Reduction With Initial Glargine Intervention'
summary: ClinicalTrials.gov registry anchor for ORIGIN omega-3 factorial context.
status: draft
quality: usable
aliases:
- ClinicalTrials.gov NCT00069784
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: other
  title: 'The ORIGIN Trial: Outcome Reduction With Initial Glargine Intervention'
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov. The ORIGIN Trial: Outcome Reduction With Initial Glargine Intervention. ClinicalTrials.gov. 2026. Accessed 2026-04-25.'
  url: https://clinicaltrials.gov/study/NCT00069784
researchEvidence:
  designKind: other
  designLabel: Trial Registry
  participantCount: 12536
  participantCountKind: reported
  populationLabel: adults with impaired fasting glucose, impaired glucose tolerance, or early type 2 diabetes at high cardiovascular risk
  durationLabel: linked ORIGIN trial follow-up; long-term clinical outcomes
  aggregateRole: context
  cohortKey: omega-3-supplementation:clinicaltrials-nct00069784-2026-04-25
evidenceBucket: cardiovascular_outcomes_boundary
whyItMatters: Maintains registry provenance for an important high-risk null trial boundary.
potentialMurphEndpoints:
- process:trial-registration
- condition:diabetes-cardiovascular-risk
protocolTakeaway: Do not use registry metadata as a direct efficacy finding.
murphTakeaway: Adjacent registry-only source.
studyDesign: trial_registry
modality: trial registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **cardiovascular_outcomes_boundary**.

**Findings:**
- **population / ORIGIN registry provenance:** Use for provenance and population boundary; outcome claims require linked publication. Effect/direction: Registry anchor for high-risk dysglycemia/early diabetes factorial omega-3 trial.

**Why it matters:** Maintains registry provenance for an important high-risk null trial boundary.

**Potential experiment signals:**
- cardiovascular mortality
- cardiovascular events
- trial registration provenance

**Protocol takeaway:** Do not use registry metadata as a direct efficacy finding.

**Claim use:** `context-only`.

## Extraction details

- **Source kind:** trial_registry
- **Study design:** trial_registry
- **Participants:** 12536 (registry_or_linked_trial_reported)
- **Population:** adults with impaired fasting glucose, impaired glucose tolerance, or early type 2 diabetes at high cardiovascular risk
- **Intervention/exposure:** oral omega-3 fatty acids versus placebo within a factorial trial
- **Comparator/control:** placebo
- **Duration/follow-up:** linked ORIGIN trial follow-up; long-term clinical outcomes
- **Endpoints:** cardiovascular mortality, cardiovascular events, trial registration provenance
- **Effect or direction:** Registry anchor only. Related ORIGIN evidence reported no reduction in cardiovascular outcomes from 1 g/day n-3 fatty acids, but this registry page should not be used as the primary efficacy source.
- **Adverse events/safety:** Registry source does not provide a standalone extracted safety result.
- **Population mismatch:** High-risk dysglycemia/early diabetes population, not general wellness users.
- **Directness:** `adjacent_variant`
- **Artifact rights status:** `unknown`

## Limitations

- Trial registry, not peer-reviewed result paper.
- Dysglycemia/high-risk population.
- Adjacent clinical-risk context.
