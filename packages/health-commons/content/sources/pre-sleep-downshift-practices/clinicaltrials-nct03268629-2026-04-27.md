---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03268629-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct03268629-2026-04-27
title: "'Mindfulness-Based Joyful Sleep' Intervention in Young and Middle-aged Individuals With Insomnia"
summary: "Trial-registry context for 'Mindfulness-Based Joyful Sleep' Intervention in Young and Middle-aged Individuals With Insomnia; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - Mindfulness-Based Joyful Sleep
  - MBJS
  - NCT03268629
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
  title: "The Efficacy of a Mindfulness-Based Intervention for Insomnia ('Mindfulness-Based Joyful Sleep') in Young and Middle-aged Individuals With Insomnia in China: Study Protocol of a Randomized Controlled Trial"
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: "ClinicalTrials.gov. The Efficacy of a Mindfulness-Based Intervention for Insomnia ('Mindfulness-Based Joyful Sleep') in Young and Middle-aged Individuals With Insomnia in China: Study Protocol of a Randomized Controlled Trial. Identifier NCT03268629. Snapshot source key dated 2026-04-27."
  url: https://clinicaltrials.gov/study/nct03268629
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct03268629
    titleHash: e6c0a8abd9bd369c15daeec4571051c46a6b8563b82fd6edaa45e9c61020d454
    url: https://clinicaltrials.gov/study/nct03268629
  canonicalUrl: https://clinicaltrials.gov/study/nct03268629
researchEvidence:
  designKind: expert_protocol
  designLabel: Registry protocol for a randomized MBJS versus CBT-I insomnia trial in China
  participantCount: 70
  participantCountKind: approximate
  populationLabel: Chinese adults aged 18-59 with DSM-5 insomnia disorder.
  durationLabel: "8 weekly 2-hour sessions with baseline, post-intervention, and 3-month follow-up assessments."
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct03268629-2026-04-27
  notes:
    - "Registry status: Unknown; last known status not yet recruiting in the registry payload."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
    - "Original extracted designKind: randomized_controlled_trial_registry."
    - "Original extracted participantCountKind: estimated."
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "The registry preserves an active-comparator mindfulness-insomnia protocol with explicit movement, Tai Chi, biomarker, PSG, and 3-month follow-up fields."
potentialMurphEndpoints:
  - sleep quality
  - sleep-onset latency
  - sleep efficiency
  - insomnia severity
  - perceived stress
  - anxiety
  - depression
  - inflammatory marker context
protocolTakeaway: Keep as clinical-supervised registry context; do not use as clean evidence for silent unguided pre-sleep meditation.
murphTakeaway: "This is a high-burden, group-based clinical insomnia program with movement practices and CBT-I comparison, useful for boundaries and endpoints."
studyDesign: Registry protocol for an estimated 70-participant randomized active-comparator trial.
modality: Group-based MBJS mindfulness/Tai Chi clinical insomnia program.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - No ClinicalTrials.gov results were posted in the extracted payload.
  - Estimated sample and unknown trial status limit outcome interpretation.
  - "Intervention includes Tai Chi, movement, group sessions, homework, and clinical insomnia treatment components rather than silent bedside practice."
populationMismatch: "Chinese adults with diagnosed insomnia in a structured clinical trial, not general users doing a short silent bedtime practice."
interventionOrExposure: "Mindfulness-Based Joyful Sleep, an 8-session weekly 2-hour group mindfulness program using MBSR, MAPs, and Tai Chi content; embedded practices include breathing meditation, body scan, sitting, standing, walking, Tai Chi, and daily-life meditation."
comparatorOrControl: "CBT-I weekly group program with stimulus control, sleep restriction, relaxation training, and cognitive therapy."
durationOrFollowUp: "8-week intervention; assessments at baseline, end of intervention, and 3-month follow-up."
endpoints:
  - PSQI sleep quality
  - sleep diary
  - polysomnography sleep quantity
  - Insomnia Severity Index
  - perceived stress
  - anxiety
  - depression
  - NF-kB inflammatory response biomarker
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event results were posted in the extracted payload.
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct03268629-2026-04-27/registry-context
    sourceKey: source_artifact:clinicaltrials-nct03268629-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct03268629-2026-04-27
    findingKind: context
    population: Young and middle-aged adults aged 18 to 59 years in China with DSM-5 insomnia disorder.
    exposure: "Mindfulness-Based Joyful Sleep, an 8-session weekly 2-hour group mindfulness program using MBSR, MAPs, and Tai Chi content; embedded practices include breathing meditation, body scan, sitting, standing, walking, Tai Chi, and daily-life meditation."
    outcome: "Trial design, active comparator, planned sleep and inflammatory endpoints, and follow-up schedule."
    summary: "Registry protocol for estimated 70 adults with insomnia randomized to MBJS or CBT-I; useful for active-comparator and measurement context, but no registry results were posted and the intervention is not silent bedtime meditation."
    evidenceUse:
      - context
      - measurement
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Registry protocol for estimated 70 adults with insomnia randomized to MBJS or CBT-I; useful for active-comparator and measurement context, but no registry results were posted and the intervention is not silent bedtime meditation.

**Why it matters:** The registry preserves an active-comparator mindfulness-insomnia protocol with explicit movement, Tai Chi, biomarker, PSG, and 3-month follow-up fields.

**Potential experiment signals:** sleep quality, sleep-onset latency, sleep efficiency, insomnia severity, perceived stress, anxiety, depression, inflammatory marker context.

**Protocol takeaway:** Keep as clinical-supervised registry context; do not use as clean evidence for silent unguided pre-sleep meditation.

**Claim use:** `context-only`.
