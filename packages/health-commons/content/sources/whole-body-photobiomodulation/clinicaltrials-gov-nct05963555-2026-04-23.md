---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct05963555-2026-04-23
title: Evaluation of Photobiomodulation or Dry Float Therapy on Sleep Quality in Middle-aged and Elderly Individuals
summary: Completed randomized three-arm registry including a direct whole-body PBM arm in adults 50-85; useful for older-adult implementation context and endpoint design, not efficacy claims.
status: draft
quality: usable
aliases:
  - NCT05963555
  - clinicaltrials-gov-nct05963555-2026-04-23
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
  title: Evaluation of Photobiomodulation or Dry Float Therapy on Sleep Quality in Middle-aged and Elderly Individuals
  authors: West Virginia University (sponsor)
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Evaluation of Photobiomodulation or Dry Float Therapy on Sleep Quality in Middle-aged and Elderly Individuals. Identifier NCT05963555.
  url: https://clinicaltrials.gov/study/NCT05963555
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Completed open-label randomized parallel-group interventional registry
  participantCount: 15
  participantCountKind: approximate
  populationLabel: Adults 50-85 years; healthy volunteers allowed; registry condition labels include sleep initiation/maintenance and sleep-wake disorders
  durationLabel: 12-week assigned intervention plus beginning/end testing; Oura and monthly surveys through the study period
  aggregateRole: primary
  cohortKey: nct05963555-middle-aged-elderly
protocolEvidence:
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: direct-sleep-and-wellbeing-evidence
    stance: context_only
    scope: direct_protocol
    result: not_efficacy_evidence
    headline: Registry includes a direct whole-body PBM arm in older adults, but no outcome results are available in the record used here.
    implication: Useful for older-adult protocol variants, endpoint selection, and adherence expectations.
    caveat: Three-arm open-label non-placebo registry; the record alone cannot establish a whole-body effect.
    displayPriority: 35
  -
    protocolKey: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
    groupId: dose-and-implementation
    stance: context_only
    scope: direct_protocol
    result: not_efficacy_evidence
    headline: Registry includes a direct whole-body PBM arm in older adults, but no outcome results are available in the record used here.
    implication: Useful for older-adult protocol variants, endpoint selection, and adherence expectations.
    caveat: Three-arm open-label non-placebo registry; the record alone cannot establish a whole-body effect.
    displayPriority: 35
evidenceBucket: Starter whole-body wellness/sleep evidence
whyItMatters: This adds older-adult direct-protocol context and shows how a whole-body arm was positioned against localized PBM and dry float therapy.
potentialMurphEndpoints:
  - total sleep time
  - resting-state EEG or qEEG
  - PHQ-9
  - circadian sleep inventory
  - monthly well-being
  - adherence
protocolTakeaway: Use as older-adult implementation context for whole-body PBM, not as efficacy proof.
murphTakeaway: Useful for trial-structure and endpoint ideas, while preserving multi-arm and registry-only limitations.
studyDesign: Completed open-label randomized parallel-group registry
modality: Whole-body NovoTHOR PBM compared with localized PBM and dry float therapy
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Starter whole-body wellness/sleep evidence**.

**Findings:** This registry describes a 3-arm randomized open-label study in adults 50-85 years old. One arm uses whole-body visible and near-infrared non-UV light in a light pod or bed, one uses localized PBM, and one uses dry float therapy. Participants are expected to complete the assigned condition 2-3 times per week for 12 weeks, wear an Oura Ring through the study period, complete monthly well-being surveys, and undergo beginning/end cognitive, behavioral, mood, qEEG, and physical assessments. Primary outcomes include resting-state EEG, PHQ-9, total sleep via Oura, and the Circadian Sleep Inventory. Healthy volunteers were allowed; inclusion required age 50-85, informed consent, and no significant untreated medical history. No extracted efficacy or adverse-event results were available in the reviewed registry materials.

**Why it matters:** It adds direct whole-body older-adult implementation context and highlights a broader endpoint battery than the younger-adult NovoTHOR registry.

**Potential experiment signals:** total sleep time, EEG or qEEG, PHQ-9, circadian sleep inventory, monthly well-being, adherence.

**Protocol takeaway:** Use as direct registry context for older-adult variants and endpoint design; do not use it as evidence that whole-body PBM improved outcomes.

**Claim use:** `context-only`.
