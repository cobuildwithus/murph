---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00127452-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct00127452-2026-04-25
title: 'Alpha Omega Trial: Study of Omega-3 Fatty Acids and Coronary Heart Disease'
summary: ClinicalTrials.gov registry anchor for Alpha Omega.
status: draft
quality: usable
aliases:
- ClinicalTrials.gov NCT00127452
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
  title: 'Alpha Omega Trial: Study of Omega-3 Fatty Acids and Coronary Heart Disease'
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov. Alpha Omega Trial: Study of Omega-3 Fatty Acids and Coronary Heart Disease. ClinicalTrials.gov. 2026. Accessed 2026-04-25.'
  url: https://clinicaltrials.gov/study/NCT00127452
researchEvidence:
  designKind: other
  designLabel: Trial Registry
  participantCount: 4837
  participantCountKind: reported
  populationLabel: post-myocardial-infarction adults in Alpha Omega Trial
  durationLabel: 2002-2009 trial period; linked publication about 40 months follow-up
  aggregateRole: context
  cohortKey: omega-3-supplementation:clinicaltrials-nct00127452-2026-04-25
evidenceBucket: cardiovascular_outcomes_boundary
whyItMatters: Anchors a frequently cited adjacent trial without duplicating outcome claims.
potentialMurphEndpoints:
- process:trial-registration
- condition:major-cardiovascular-events
protocolTakeaway: Use registry only for provenance.
murphTakeaway: Adjacent registry context.
studyDesign: trial_registry
modality: trial registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
---
This source is included for **cardiovascular_outcomes_boundary**.

**Findings:**
- **population / Alpha Omega registry provenance:** Use for trial provenance only. Effect/direction: Registry anchor for post-MI EPA-DHA/ALA margarine-spread trial.

**Why it matters:** Anchors a frequently cited adjacent trial without duplicating outcome claims.

**Potential experiment signals:**
- major cardiovascular events
- trial registration provenance

**Protocol takeaway:** Use registry only for provenance.

**Claim use:** `context-only`.

## Extraction details

- **Source kind:** trial_registry
- **Study design:** trial_registry
- **Participants:** 4837 (registry_or_linked_trial_reported)
- **Population:** post-myocardial-infarction adults in Alpha Omega Trial
- **Intervention/exposure:** EPA-DHA, ALA, both, or placebo delivered in margarine spread
- **Comparator/control:** placebo margarine
- **Duration/follow-up:** 2002-2009 trial period; linked publication about 40 months follow-up
- **Endpoints:** major cardiovascular events, trial registration provenance
- **Effect or direction:** Registry anchor only; efficacy should be taken from linked Alpha Omega publications.
- **Adverse events/safety:** No registry-based safety result extracted.
- **Population mismatch:** Post-MI population and food-spread intervention.
- **Directness:** `adjacent_variant`
- **Artifact rights status:** `unknown`

## Limitations

- Trial registry rather than peer-reviewed results.
- Dietary-spread delivery and secondary-prevention population.
- Use for provenance only.
