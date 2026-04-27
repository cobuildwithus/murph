---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ons-sleep-wake-mbsr-2026-04-27
slug: sources/pre-sleep-downshift-practices/ons-sleep-wake-mbsr-2026-04-27
title: Mindfulness-Based Stress Reduction for Sleep-Wake Disturbances
summary: Oncology-specific MBSR sleep-wake evidence summary; useful as population-mismatch context.
status: draft
quality: usable
aliases:
  - Mindfulness-Based Stress Reduction for Sleep-Wake Disturbances
categories:
  - pre-sleep-downshift-practices
relations:
  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: guideline
  title: Mindfulness-Based Stress Reduction for Sleep-Wake Disturbances
  authors: Oncology Nursing Society
  year: 2026
  journal: Oncology Nursing Society Putting Evidence Into Practice
  citation: Oncology Nursing Society (2026) Mindfulness-Based Stress Reduction for Sleep-Wake Disturbances. Oncology Nursing Society Putting Evidence Into Practice.
  url: https://www.ons.org/clinical-tools/pep/sleep-wake-disturbances/mindfulness-based-stress-reduction
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 828ec0fa5635fbf918d32c555a9d69ee864fbd0b516fe17c2af60e9f8d34328f
    url: https://www.ons.org/clinical-tools/pep/sleep-wake-disturbances/mindfulness-based-stress-reduction
  canonicalUrl: https://www.ons.org/clinical-tools/pep/sleep-wake-disturbances/mindfulness-based-stress-reduction
researchEvidence:
  designKind: guideline
  designLabel: Professional oncology evidence summary
  populationLabel: Cancer patients and cancer caregivers
  durationLabel: Varies across cited MBSR studies
  aggregateRole: synthesis
  cohortKey: cohort-ons-sleep-wake-mbsr-2026-04-27
evidenceBucket: safety_adverse_effects
whyItMatters: Oncology-specific MBSR sleep-wake evidence summary; useful as population-mismatch context.
potentialMurphEndpoints:
  - sleep-wake disturbance
  - sleep quality
  - fatigue
  - mood
  - population mismatch
protocolTakeaway: Use as context for cancer/caregiver populations only.
murphTakeaway: Use as context for cancer/caregiver populations only.
studyDesign: Professional oncology evidence summary
modality: MBSR evidence summary for cancer symptom management and sleep-wake disturbances
interventionOrExposure: MBSR evidence summary for cancer symptom management and sleep-wake disturbances
comparatorOrControl: Varies across cited studies
durationOrFollowUp: Varies across cited MBSR studies
endpointSummary: ONS labels MBSR for sleep-wake disturbances as likely to be effective in oncology contexts; this is not a safety or efficacy claim for healthy sleepers.
adverseEventsOrSafetyNotes: Useful for cancer-specific context and for not generalizing oncology evidence to the general population.
limitations: Evidence summary; underlying studies are in cancer populations and include multi-component MBSR rather than silent bedtime meditation.
populationMismatch: Cancer patient/caregiver populations and MBSR bundles are not the target protocol population or dose.
directnessToProtocol: safety_boundary
claimUse: safety-only
sourceFindings:
  -
    findingId: finding:ons-sleep-wake-mbsr-2026-04-27:primary-safety-context
    sourceKey: source_artifact:ons-sleep-wake-mbsr-2026-04-27
    extractedFromArtifactId: art_ons_sleep_wake_mbsr_2026_04_27_metadata
    findingKind: context
    population: Cancer patients and cancer caregivers
    exposure: MBSR evidence summary for cancer symptom management and sleep-wake disturbances
    outcome: sleep-wake disturbance; sleep quality; fatigue; mood; population mismatch
    summary: "The ONS evidence summary supports MBSR as an oncology sleep-wake disturbance intervention, but the evidence is cancer-specific and bundled, so it should not be generalized to healthy bedtime silent meditation."
    evidenceUse:
      - context
      - safety
murphV1Priority: High
pdfRightsStatus: unknown
---
## Extraction notes

This source is included for **safety_adverse_effects**.

**Findings:** The ONS evidence summary supports MBSR as an oncology sleep-wake disturbance intervention, but the evidence is cancer-specific and bundled, so it should not be generalized to healthy bedtime silent meditation. [source_artifact:ons-sleep-wake-mbsr-2026-04-27]

**Why it matters:** Oncology-specific MBSR sleep-wake evidence summary; useful as population-mismatch context. [source_artifact:ons-sleep-wake-mbsr-2026-04-27]

**Potential experiment signals:** sleep-wake disturbance, sleep quality, fatigue, mood, population mismatch. [source_artifact:ons-sleep-wake-mbsr-2026-04-27]

**Protocol takeaway:** Use as context for cancer/caregiver populations only. [source_artifact:ons-sleep-wake-mbsr-2026-04-27]

**Claim use:** `safety-only`.

**Safety notes:** Useful for cancer-specific context and for not generalizing oncology evidence to the general population. [source_artifact:ons-sleep-wake-mbsr-2026-04-27]

**Limitations and mismatch:** Evidence summary; underlying studies are in cancer populations and include multi-component MBSR rather than silent bedtime meditation. Cancer patient/caregiver populations and MBSR bundles are not the target protocol population or dose. [source_artifact:ons-sleep-wake-mbsr-2026-04-27]
