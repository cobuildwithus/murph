---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct00317707-2026-04-25
slug: sources/omega-3-supplementation/clinicaltrials-nct00317707-2026-04-25
title: 'Risk and Prevention Study: Evaluation of the Efficacy of n-3 PUFA in Subjects at High Cardiovascular Risk'
summary: ClinicalTrials.gov registry anchor for the Risk and Prevention n-3 PUFA trial.
status: draft
quality: usable
aliases:
- ClinicalTrials.gov / Mario Negri Institute for Pharmacological Research 2026
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
  title: 'Risk and Prevention Study: Evaluation of the Efficacy of n-3 PUFA in Subjects at High Cardiovascular Risk'
  authors: ClinicalTrials.gov / Mario Negri Institute for Pharmacological Research
  year: 2026
  journal: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov / Mario Negri Institute for Pharmacological Research. Risk and Prevention Study: Evaluation of the Efficacy of n-3 PUFA in Subjects at High Cardiovascular Risk. ClinicalTrials.gov. 2026. Accessed 2026-04-25.'
  url: https://clinicaltrials.gov/study/NCT00317707
researchEvidence:
  designKind: other
  designLabel: Trial Registry
  participantCount: 12513
  participantCountKind: reported
  populationLabel: subjects at high cardiovascular risk in the Risk and Prevention Study
  durationLabel: long-term follow-up; linked publication reports about 5 years
  aggregateRole: primary
  cohortKey: omega-3-supplementation:clinicaltrials-nct00317707-2026-04-25
evidenceBucket: cardiovascular_outcomes_boundary
whyItMatters: Keeps registration provenance attached to the already-present RCT.
potentialMurphEndpoints:
- process:trial-registration
- condition:cardiovascular-disease-events
protocolTakeaway: Registry evidence should support provenance only.
murphTakeaway: No standalone outcome claim from registry metadata.
studyDesign: trial_registry
modality: trial registry
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---
This source is included for **cardiovascular_outcomes_boundary**.

**Findings:**
- **population / trial registry provenance:** Use for design/provenance only; efficacy belongs to the linked publication. Effect/direction: Registry anchor for Risk and Prevention Study in subjects at high cardiovascular risk.

**Why it matters:** Keeps registration provenance attached to the already-present RCT.

**Potential experiment signals:**
- cardiovascular events
- mortality
- adverse events
- trial registration provenance

**Protocol takeaway:** Registry evidence should support provenance only.

**Claim use:** `context-only`.

## Extraction details

- **Source kind:** trial_registry
- **Study design:** trial_registry
- **Participants:** 12513 (registry_or_linked_trial_reported)
- **Population:** subjects at high cardiovascular risk in the Risk and Prevention Study
- **Intervention/exposure:** oral n-3 PUFA
- **Comparator/control:** control/placebo per registry trial design
- **Duration/follow-up:** long-term follow-up; linked publication reports about 5 years
- **Endpoints:** cardiovascular events, mortality, adverse events, trial registration provenance
- **Effect or direction:** Registry anchor only; use linked outcome publication for efficacy results rather than registry metadata.
- **Adverse events/safety:** Registry includes safety/protocol provenance, but no extracted adverse-event result is used as an efficacy claim.
- **Population mismatch:** High cardiovascular-risk patients, not general wellness users.
- **Directness:** `direct_protocol`
- **Artifact rights status:** `unknown`

## Limitations

- Trial registry, not a peer-reviewed result article.
- High cardiovascular-risk population.
- Use for design/provenance only.
