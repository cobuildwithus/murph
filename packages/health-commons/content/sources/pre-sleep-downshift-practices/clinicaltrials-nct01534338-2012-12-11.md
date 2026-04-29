---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01534338-2012-12-11
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct01534338-2012-12-11
title: Effect of Mindfulness Training on Sleep and Inflammation Among Older Adults With Sleep Problems
summary: "Trial-registry context for Effect of Mindfulness Training on Sleep and Inflammation Among Older Adults With Sleep Problems; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - MAPS
  - A Randomized Controlled Trial Testing the Effect of Mindfulness Practices Versus Sleep Education on Sleep and Inflammation Among Older Adults With Sleep Problems
  - NCT01534338
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
  title: A Randomized Controlled Trial Testing the Effect of Mindfulness Practices Versus Sleep Education on Sleep and Inflammation Among Older Adults With Sleep Problems
  authors: ClinicalTrials.gov
  year: 2012
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. A Randomized Controlled Trial Testing the Effect of Mindfulness Practices Versus Sleep Education on Sleep and Inflammation Among Older Adults With Sleep Problems. Identifier NCT01534338. Snapshot source key dated 2012-12-11.
  url: https://clinicaltrials.gov/study/nct01534338
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct01534338
    titleHash: 54859d69bc0ca1869f004aff6864a621fd66ec397e839ea3b2c1b4155f922c83
    url: https://clinicaltrials.gov/study/nct01534338
  canonicalUrl: https://clinicaltrials.gov/study/nct01534338
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for the MAPS older-adult sleep and inflammation randomized trial
  participantCount: 48
  participantCountKind: reported
  populationLabel: Older adults with current sleep problems or insomnia symptoms.
  durationLabel: 6 weekly 2-hour classes with post-intervention assessment within 2 weeks.
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct01534338-2012-12-11
  notes:
    - "Registry status: Completed."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "This registry anchors the older-adult MAPS sleep trial and captures dose, active comparator, daily practice-log, sleep diary, and inflammation endpoints for duplicate matching."
potentialMurphEndpoints:
  - sleep-onset latency
  - sleep efficiency
  - insomnia severity
  - pre-sleep arousal
  - fatigue/daytime impairment
  - inflammatory markers
protocolTakeaway: Use as registry context and linked-publication anchor only; do not cite the registry as direct evidence for silent unguided meditation before bed.
murphTakeaway: "The registered intervention is a supervised six-week mindfulness course in older adults, not a short silent bedtime-only self-experiment."
studyDesign: Completed randomized trial registry record; registry has publication linkage but no posted registry results.
modality: Supervised MAPs mindfulness meditation group with daily homework and sleep hygiene material.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - "Registry source, not an independent peer-reviewed results report."
  - "The exposure bundles group instruction, guided practices, daily homework, sleep hygiene content, and multiple mindfulness forms."
  - Older adult sleep-problem sample limits direct generalization to broad Murph users.
populationMismatch: Older adults with sleep problems rather than a general adult self-experiment sample; supervised group training rather than silent pre-bed practice.
interventionOrExposure: "UCLA Mindful Awareness Practices (MAPs) mindfulness meditation: weekly 2-hour group classes for 6 weeks, in-class practice, daily meditation homework, sitting and walking somatosensory-focused meditation, audio-guided body scan, loving-kindness meditation, and sleep hygiene material."
comparatorOrControl: "Active sleep education control with weekly 2-hour group classes for 6 weeks, sleep biology/sleep hygiene education, and sleep self-monitoring."
durationOrFollowUp: 6-week intervention; outcomes planned within 2 weeks after intervention.
endpoints:
  - daily sleep diary
  - Pittsburgh Sleep Quality Index
  - Fatigue Symptom Inventory
  - Insomnia Severity Index
  - Pre-Sleep Arousal Scale
  - mindfulness questionnaire and daily practice log
  - peripheral inflammatory biology markers
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No ClinicalTrials.gov registry results or adverse-event table were posted in the extracted payload.
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct01534338-2012-12-11/registry-context
    sourceKey: source_artifact:clinicaltrials-nct01534338-2012-12-11
    extractedFromArtifactId: art-clinicaltrials-nct01534338-2012-12-11
    findingKind: context
    population: Adults aged 55 years and older with current sleep problems; healthy volunteers were allowed.
    exposure: "UCLA Mindful Awareness Practices (MAPs) mindfulness meditation: weekly 2-hour group classes for 6 weeks, in-class practice, daily meditation homework, sitting and walking somatosensory-focused meditation, audio-guided body scan, loving-kindness meditation, and sleep hygiene material."
    outcome: "Trial identity, planned sleep endpoints, daily practice-log methods, and publication linkage."
    summary: "Registry record for a 48-participant older-adult MAPS mindfulness-versus-sleep-education trial; useful for design and source identity, but it has no posted registry results and does not isolate silent bedtime meditation."
    evidenceUse:
      - context
      - measurement
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Registry record for a 48-participant older-adult MAPS mindfulness-versus-sleep-education trial; useful for design and source identity, but it has no posted registry results and does not isolate silent bedtime meditation.

**Why it matters:** This registry anchors the older-adult MAPS sleep trial and captures dose, active comparator, daily practice-log, sleep diary, and inflammation endpoints for duplicate matching.

**Potential experiment signals:** sleep-onset latency, sleep efficiency, insomnia severity, pre-sleep arousal, fatigue/daytime impairment, inflammatory markers.

**Protocol takeaway:** Use as registry context and linked-publication anchor only; do not cite the registry as direct evidence for silent unguided meditation before bed.

**Claim use:** `context-only`.
