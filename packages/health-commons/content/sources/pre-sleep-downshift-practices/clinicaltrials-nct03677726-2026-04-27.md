---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03677726-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct03677726-2026-04-27
title: Improving Sleep Continuity Through Mindfulness Training for Better Cognitive Ageing
summary: "Trial-registry context for Improving Sleep Continuity Through Mindfulness Training for Better Cognitive Ageing; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - MIST
  - Improving Sleep Continuity Through Mindfulness Training for Better Cognitive Ageing.
  - NCT03677726
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
  title: Improving Sleep Continuity Through Mindfulness Training for Better Cognitive Ageing.
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Improving Sleep Continuity Through Mindfulness Training for Better Cognitive Ageing.. Identifier NCT03677726. Snapshot source key dated 2026-04-27.
  url: https://clinicaltrials.gov/study/nct03677726
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct03677726
    titleHash: e97a054fddc622c0ea9e320c2e0f87e66d061afbdbaad7e3753997980f7fed41
    url: https://clinicaltrials.gov/study/nct03677726
  canonicalUrl: https://clinicaltrials.gov/study/nct03677726
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Completed registry record for MIST older-adult MBTI versus sleep-hygiene/exercise trial
  participantCount: 150
  participantCountKind: reported
  populationLabel: Older adults aged 50-80 with sleep difficulties in a cognitive-aging trial.
  durationLabel: "8 weekly 2-hour sessions with pre/post objective sleep, cognition, and fMRI assessment."
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct03677726-2026-04-27
  notes:
    - "Registry status: Completed."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "The registry provides unusually rich objective sleep, cognitive, and neuroimaging endpoint context for an older-adult MBTI study."
potentialMurphEndpoints:
  - sleep-onset latency
  - wake after sleep onset
  - sleep efficiency
  - total sleep time
  - insomnia severity
  - pre-sleep arousal
  - heart rate during sleep
protocolTakeaway: Use as registry context for supervised MBTI dose and endpoint structure; do not cite it as a direct silent-bedtime protocol test.
murphTakeaway: The registered study is high-contact clinical MBTI in older adults and is best used for endpoint ideas and source linkage.
studyDesign: Completed randomized active-comparator trial registry record with linked derived publications.
modality: Supervised MBTI course for older adults with sleep difficulties.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - Registry source; linked publications should be used for effect estimates.
  - Older-adult cognitive-aging sample differs from general Murph users.
  - "The intervention is an 8-week therapist-led MBTI course, not a short unguided silent bedtime meditation."
populationMismatch: Older adults with sleep difficulties and cognitive-aging assessment rather than a broad healthy adult bedtime practice sample.
interventionOrExposure: "Mindfulness Based Therapy for Insomnia delivered as eight 2-hour sessions covering mindfulness of breath, body and movement, senses and informal practice, and empathy and compassion."
comparatorOrControl: "Sleep Hygiene Education Exercise Program, eight weekly 2-hour sessions focused on sleep hygiene concepts and implementation."
durationOrFollowUp: "8-week intervention with pre/post objective and subjective sleep, cognition, and neuroimaging assessments."
endpoints:
  - PSQI
  - PSG sleep onset latency
  - Actiwatch sleep onset latency
  - PSG and Actiwatch WASO
  - Insomnia Severity Index
  - cognitive attention tasks
  - fMRI structural and functional measures
  - pre-sleep arousal
  - heart rate during sleep
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event table was posted in the extracted payload.
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct03677726-2026-04-27/registry-context
    sourceKey: source_artifact:clinicaltrials-nct03677726-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct03677726-2026-04-27
    findingKind: context
    population: Adults aged 50 to 80 with sleep difficulties and cognitive-aging outcomes in Singapore; healthy volunteers were allowed.
    exposure: "Mindfulness Based Therapy for Insomnia delivered as eight 2-hour sessions covering mindfulness of breath, body and movement, senses and informal practice, and empathy and compassion."
    outcome: "Trial identity, MBTI versus sleep-hygiene comparator, objective sleep and cognitive endpoints."
    summary: "Completed registry record for a 150-participant older-adult MBTI versus sleep-hygiene/exercise trial with PSG, actigraphy, subjective sleep, cognition, and fMRI endpoints; it should be used for design and endpoint context rather than direct silent-bedtime claims."
    evidenceUse:
      - context
      - measurement
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Completed registry record for a 150-participant older-adult MBTI versus sleep-hygiene/exercise trial with PSG, actigraphy, subjective sleep, cognition, and fMRI endpoints; it should be used for design and endpoint context rather than direct silent-bedtime claims.

**Why it matters:** The registry provides unusually rich objective sleep, cognitive, and neuroimaging endpoint context for an older-adult MBTI study.

**Potential experiment signals:** sleep-onset latency, wake after sleep onset, sleep efficiency, total sleep time, insomnia severity, pre-sleep arousal, heart rate during sleep.

**Protocol takeaway:** Use as registry context for supervised MBTI dose and endpoint structure; do not cite it as a direct silent-bedtime protocol test.

**Claim use:** `context-only`.
