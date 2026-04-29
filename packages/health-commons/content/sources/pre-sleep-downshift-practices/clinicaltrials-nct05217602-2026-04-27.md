---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct05217602-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct05217602-2026-04-27
title: Incentivizing Meditation App Habit Formation
summary: "Trial-registry context for Incentivizing Meditation App Habit Formation; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - Calm habit formation trial
  - NCT05217602
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
  kind: other
  title: Incentivizing Meditation App Habit Formation
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Incentivizing Meditation App Habit Formation. Identifier NCT05217602. Snapshot source key dated 2026-04-27.
  url: https://clinicaltrials.gov/study/nct05217602
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct05217602
    titleHash: 099f036fc24c18d8f232ef584e7b6275969097c1492095ed655414b1f942f8f7
    url: https://clinicaltrials.gov/study/nct05217602
  canonicalUrl: https://clinicaltrials.gov/study/nct05217602
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Completed randomized meditation-app adherence and habit-formation registry record
  participantCount: 597
  participantCountKind: reported
  populationLabel: Stressed new Calm subscribers with low recent meditation exposure.
  durationLabel: 16-week app-adherence study with 8-week intervention and 8-week follow-up.
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct05217602-2026-04-27
  notes:
    - "Registry status: Completed."
    - "Directness to target protocol: adjacent_variant."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "Relevant mainly to adherence mechanics, 10-minute app dosing, anchoring plans, and habit-maintenance signals, not sleep efficacy."
potentialMurphEndpoints:
  - meditation adherence
  - habit strength
  - perceived stress
  - sleep disturbance/ISI
  - anxiety
  - mindfulness
protocolTakeaway: Use only as adherence and implementation context for meditation habit formation; do not cite for sleep efficacy or silent bedtime benefit.
murphTakeaway: "Anchoring/reward mechanics may inform how users sustain a meditation habit, but the trial does not test bedtime sleep response."
studyDesign: Completed randomized app habit-formation registry record; no registry results were posted in the extracted payload.
modality: "Commercial app adherence intervention using anchoring plans, reminders, and rewards."
directnessToProtocol: adjacent_variant
claimUse: context-only
limitations:
  - "Primary outcomes are app-use adherence, not sleep improvement."
  - "Population is new paying Calm subscribers with stress, not people selected for insomnia or a bedtime protocol."
  - "Commercial app guidance, rewards, and anchoring plans are bundled; silent meditation is not isolated."
  - No registry-posted efficacy results were extracted.
populationMismatch: "Stressed app subscribers, not a sleep-protocol cohort; app-guided commercial meditation and incentives rather than silent pre-bed practice."
interventionOrExposure: "Prescribed Calm app usage of 10 minutes/day with personalized anchoring plan, weekly reminders, and in-kind rewards conditional either on anchoring-plan meditation or any-time meditation depending on arm."
comparatorOrControl: Usual Calm control with prescribed 10 minutes/day and personalized anchoring plan but no in-kind rewards; all arms received survey incentives.
durationOrFollowUp: "8-week intervention plus 8-week post-intervention follow-up; baseline, week 8, and week 16 assessments."
endpoints:
  - mean adherence persistence weeks 1-8
  - mean adherence persistence weeks 8-16
  - Perceived Stress Scale
  - HADS anxiety
  - Mindful Attention Awareness Scale
  - Impact of Events Scale-Revised PTSD
  - Insomnia Severity Index sleep disturbances
  - Self-Report Habit Index
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event results were posted in the extracted payload.
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct05217602-2026-04-27/adherence-registry-context
    sourceKey: source_artifact:clinicaltrials-nct05217602-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct05217602-2026-04-27
    findingKind: context
    population: New paying self-initiated Calm subscribers aged 18 years or older in the United States or U.S. territories with Perceived Stress Scale score at least 15.
    exposure: "Prescribed Calm app usage of 10 minutes/day with personalized anchoring plan, weekly reminders, and in-kind rewards conditional either on anchoring-plan meditation or any-time meditation depending on arm."
    outcome: "Meditation app adherence persistence, habit strength, stress, and secondary sleep-disturbance measurement."
    summary: "Completed registry record for 597 new Calm subscribers randomized to anchoring/reward habit-formation strategies around a 10-minute/day Calm prescription; useful for adherence context only, not efficacy of silent meditation before bed."
    evidenceUse:
      - context
      - adjacent_variant
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Completed registry record for 597 new Calm subscribers randomized to anchoring/reward habit-formation strategies around a 10-minute/day Calm prescription; useful for adherence context only, not efficacy of silent meditation before bed.

**Why it matters:** Relevant mainly to adherence mechanics, 10-minute app dosing, anchoring plans, and habit-maintenance signals, not sleep efficacy.

**Potential experiment signals:** meditation adherence, habit strength, perceived stress, sleep disturbance/ISI, anxiety, mindfulness.

**Protocol takeaway:** Use only as adherence and implementation context for meditation habit formation; do not cite for sleep efficacy or silent bedtime benefit.

**Claim use:** `context-only`.
