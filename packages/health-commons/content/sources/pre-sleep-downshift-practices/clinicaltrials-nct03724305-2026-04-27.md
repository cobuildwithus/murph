---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03724305-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct03724305-2026-04-27
title: Reduce Emotional Symptoms of Insomnia With SleepTreatment
summary: "Trial-registry context for Reduce Emotional Symptoms of Insomnia With SleepTreatment; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - RESIST
  - Reduce Emotional Symptoms of Insomnia With Sleep Treatment
  - NCT03724305
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
  title: Reduce Emotional Symptoms of Insomnia With Sleep Treatment
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Reduce Emotional Symptoms of Insomnia With Sleep Treatment. Identifier NCT03724305. Snapshot source key dated 2026-04-27.
  url: https://clinicaltrials.gov/study/nct03724305
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct03724305
    titleHash: d4bc52b5feaccbfef02a21c368a2dbc11ab99188faa5bf41972d0e461343a844
    url: https://clinicaltrials.gov/study/nct03724305
  canonicalUrl: https://clinicaltrials.gov/study/nct03724305
researchEvidence:
  designKind: expert_protocol
  designLabel: Completed single-arm open-label MBTI telemedicine registry record with posted registry results
  participantCount: 21
  participantCountKind: reported
  populationLabel: Adults with treatment-resistant insomnia and cognitive arousal/rumination context.
  durationLabel: "8 MBTI sessions with pre-treatment, post-treatment, and 6-month follow-up assessments."
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct03724305-2026-04-27
  notes:
    - "Registry status: Completed; ClinicalTrials.gov results posted."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
    - "Original extracted designKind: single_arm_trial_registry."
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: This registry is useful because it posts single-arm outcome means and adverse-event counts for telemedicine MBTI in treatment-resistant insomnia.
potentialMurphEndpoints:
  - insomnia severity
  - mindfulness level
  - sleep-onset latency proxy via ISI
  - adverse events/safety
protocolTakeaway: "Preserve the positive within-person ISI direction and zero posted adverse events, but keep it context-only because it is single-arm, clinical, supervised, and not a silent bedtime-only protocol."
murphTakeaway: "The registry suggests feasibility/safety context for supervised MBTI, not causal evidence for a Murph bedtime self-experiment."
studyDesign: "Completed single-arm open-label registry record; the ledger had labeled this RCT, but the extracted registry payload reports allocation NA/single group."
modality: Individual telemedicine MBTI for treatment-resistant insomnia.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - Single-arm open-label trial with no comparator; causal effect cannot be inferred from registry results.
  - Small sample and treatment-resistant clinical insomnia population.
  - "Telemedicine MBTI is a therapist-led clinical intervention, not silent unguided meditation before bed."
populationMismatch: Treatment-resistant clinical insomnia sample rather than general users; supervised individual telemedicine therapy rather than self-directed silent bedtime meditation.
interventionOrExposure: Mindfulness-Based Therapy for Insomnia delivered through telemedicine video in individual therapy format over 8 sessions.
comparatorOrControl: No comparator; single-group open-label trial.
durationOrFollowUp: "Pre-treatment, post-treatment about 7 weeks after treatment initiation, and 6-month follow-up after treatment conclusion."
endpoints:
  - Insomnia Severity Index
  - Five Facet Mindfulness Questionnaire-15
  - adverse events
effectEstimatesOrDirection: "Single-arm posted registry means: ISI 16.42 (SD 3.95) pre-treatment, 8.37 (SD 4.19) post-treatment, 11.72 (SD 4.95) at 6-month follow-up; no comparator."
adverseEventsOrSafetyNotes: "Registry adverse-event table reports 0 deaths, 0 serious adverse events, and 0 other adverse events among 21 at risk, based on self-report during treatment, post-treatment, and 6-month follow-up."
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct03724305-2026-04-27/single-arm-registry-results
    sourceKey: source_artifact:clinicaltrials-nct03724305-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct03724305-2026-04-27
    findingKind: intervention_result
    population: Adults aged 18 years and older with clinically significant insomnia symptoms and inadequate response to prior insomnia psychotherapy or pharmacotherapy.
    exposure: Mindfulness-Based Therapy for Insomnia delivered through telemedicine video in individual therapy format over 8 sessions.
    outcome: "Insomnia Severity Index and mindfulness scores over pre-treatment, post-treatment, and 6-month follow-up."
    summary: "In this 21-participant single-arm telemedicine MBTI registry result, mean ISI was 16.42 pre-treatment, 8.37 post-treatment, and 11.72 at 6 months; without a comparator, this is positive within-person context but not causal evidence for silent bedtime meditation."
    evidenceUse:
      - context
      - efficacy
  -
    findingId: finding:clinicaltrials-nct03724305-2026-04-27/registry-adverse-events
    sourceKey: source_artifact:clinicaltrials-nct03724305-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct03724305-2026-04-27
    findingKind: adverse_event
    population: Adults aged 18 years and older with clinically significant insomnia symptoms and inadequate response to prior insomnia psychotherapy or pharmacotherapy.
    exposure: Mindfulness-Based Therapy for Insomnia delivered through telemedicine video in individual therapy format over 8 sessions.
    outcome: "Registry-posted adverse events through treatment, post-treatment, and 6-month follow-up."
    summary: "The registry adverse-event module reports 0 deaths, 0 serious adverse events, and 0 other adverse events among 21 participants at risk in the MBTI group; small single-arm sample and self-report ascertainment limit safety inference."
    evidenceUse:
      - safety
      - context
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** In this 21-participant single-arm telemedicine MBTI registry result, mean ISI was 16.42 pre-treatment, 8.37 post-treatment, and 11.72 at 6 months; without a comparator, this is positive within-person context but not causal evidence for silent bedtime meditation.

**Why it matters:** This registry is useful because it posts single-arm outcome means and adverse-event counts for telemedicine MBTI in treatment-resistant insomnia.

**Potential experiment signals:** insomnia severity, mindfulness level, sleep-onset latency proxy via ISI, adverse events/safety.

**Protocol takeaway:** Preserve the positive within-person ISI direction and zero posted adverse events, but keep it context-only because it is single-arm, clinical, supervised, and not a silent bedtime-only protocol.

**Claim use:** `context-only`.
