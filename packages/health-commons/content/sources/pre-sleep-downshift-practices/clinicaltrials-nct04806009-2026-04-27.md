---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04806009-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct04806009-2026-04-27
title: Evaluating an Online Mindfulness-Based Intervention for Insomnia
summary: "Trial-registry context for Evaluating an Online Mindfulness-Based Intervention for Insomnia; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - Mindful Living With Insomnia
  - MLWI
  - NCT04806009
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
  title: "Evaluating an Online Mindfulness-Based Intervention for Individuals With Insomnia in China: A Randomized Controlled Trial"
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: "ClinicalTrials.gov. Evaluating an Online Mindfulness-Based Intervention for Individuals With Insomnia in China: A Randomized Controlled Trial. Identifier NCT04806009. Snapshot source key dated 2026-04-27."
  url: https://clinicaltrials.gov/study/nct04806009
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct04806009
    titleHash: 49868f9643c814f9afc632cd676b73449caa6b4ebf0352271445c72d1fc225a2
    url: https://clinicaltrials.gov/study/nct04806009
  canonicalUrl: https://clinicaltrials.gov/study/nct04806009
researchEvidence:
  designKind: expert_protocol
  designLabel: Registry protocol for an online MLWI versus CBT-I randomized trial
  participantCount: 1000
  participantCountKind: approximate
  populationLabel: Chinese adults aged 18-59 with insomnia symptoms/poor sleep quality in an online trial.
  durationLabel: 12 online sessions over 6 weeks with 3-month follow-up.
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct04806009-2026-04-27
  notes:
    - "Registry status: Unknown; last known status not yet recruiting in the registry payload."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
    - "Original extracted designKind: randomized_controlled_trial_registry."
    - "Original extracted participantCountKind: estimated."
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "The registry is useful for online-delivery and wristband endpoint context, and for matching to the linked BMJ Open protocol."
potentialMurphEndpoints:
  - sleep quality
  - sleep-onset latency proxy via ISI
  - sleep efficiency proxy via wristband sleep quality
  - sleep duration
  - stress
  - anxiety
  - depression
  - mindfulness
protocolTakeaway: Use as digital clinical context and source linkage only; do not present MLWI as evidence for silent pre-bed meditation.
murphTakeaway: "This is a multi-session online intervention with lectures, homework, and sleep hygiene, not a simple silent bedtime dose."
studyDesign: Registry protocol for estimated 1000-participant randomized active-comparator online trial.
modality: Online guided mHealth mindfulness-insomnia program via WeChat.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - No ClinicalTrials.gov results were posted in the extracted payload.
  - Estimated sample and unknown status limit use for outcome claims.
  - "Online program bundles mindfulness, lectures, movement, sleep hygiene, and homework."
populationMismatch: Chinese adults in a structured online insomnia program rather than broad users trying a silent bedtime self-experiment.
interventionOrExposure: "Mindful Living With Insomnia (MLWI) delivered through a WeChat mini-program: 12 sessions across 6 weeks, two 0.5-hour sessions weekly, including lectures, mindfulness practices, common difficulties/coping, homework, sleep hygiene, mindful breathing, body scan, dealing with thoughts/emotions, meditation, movement, and daily-life mindfulness."
comparatorOrControl: Online CBT-I through a WeChat mini-program with 12 sessions across 6 weeks.
durationOrFollowUp: "6-week intervention with baseline, end-of-intervention, and 3-month follow-up assessments."
endpoints:
  - PSQI sleep quality
  - Insomnia Severity Index
  - Mi Smart Band sleep duration and quality
  - daytime activity
  - perceived stress
  - anxiety
  - depression
  - mindfulness
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event results were posted in the extracted payload.
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct04806009-2026-04-27/registry-context
    sourceKey: source_artifact:clinicaltrials-nct04806009-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct04806009-2026-04-27
    findingKind: context
    population: "Adults aged 18 to 59 in China with PSQI score greater than 5, able to read/write Chinese and access online services."
    exposure: "Mindful Living With Insomnia (MLWI) delivered through a WeChat mini-program: 12 sessions across 6 weeks, two 0.5-hour sessions weekly, including lectures, mindfulness practices, common difficulties/coping, homework, sleep hygiene, mindful breathing, body scan, dealing with thoughts/emotions, meditation, movement, and daily-life mindfulness."
    outcome: "Online mindfulness-insomnia trial design, CBT-I comparator, wristband and symptom endpoints."
    summary: "Registry protocol for an estimated 1000 adults randomized to MLWI or online CBT-I through WeChat; useful for digital-delivery and endpoint context, but no results were posted and the intervention is not silent bedtime meditation."
    evidenceUse:
      - context
      - measurement
      - adjacent_variant
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Registry protocol for an estimated 1000 adults randomized to MLWI or online CBT-I through WeChat; useful for digital-delivery and endpoint context, but no results were posted and the intervention is not silent bedtime meditation.

**Why it matters:** The registry is useful for online-delivery and wristband endpoint context, and for matching to the linked BMJ Open protocol.

**Potential experiment signals:** sleep quality, sleep-onset latency proxy via ISI, sleep efficiency proxy via wristband sleep quality, sleep duration, stress, anxiety, depression, mindfulness.

**Protocol takeaway:** Use as digital clinical context and source linkage only; do not present MLWI as evidence for silent pre-bed meditation.

**Claim use:** `context-only`.
