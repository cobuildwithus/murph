---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04443959-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct04443959-2026-04-27
title: Telemedicine Mindfulness-based Therapy for Perinatal Insomnia
summary: "Trial-registry context for Telemedicine Mindfulness-based Therapy for Perinatal Insomnia; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - PUMAS
  - "Telemedicine Mindfulness-based Therapy for Perinatal Insomnia: An Open-label Trial."
  - NCT04443959
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
  title: "Telemedicine Mindfulness-based Therapy for Perinatal Insomnia: An Open-label Trial."
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: "ClinicalTrials.gov. Telemedicine Mindfulness-based Therapy for Perinatal Insomnia: An Open-label Trial.. Identifier NCT04443959. Snapshot source key dated 2026-04-27."
  url: https://clinicaltrials.gov/study/nct04443959
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct04443959
    titleHash: 3eaa8d9980b67552d16539136548b8b88460758245cda15fd040abfe8871fb5b
    url: https://clinicaltrials.gov/study/nct04443959
  canonicalUrl: https://clinicaltrials.gov/study/nct04443959
researchEvidence:
  designKind: expert_protocol
  designLabel: Completed open-label single-arm PUMAS telemedicine registry record
  participantCount: 12
  participantCountKind: reported
  populationLabel: Pregnant women with prenatal insomnia.
  durationLabel: 6 weekly telemedicine sessions during pregnancy with pre/post assessment.
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct04443959-2026-04-27
  notes:
    - "Registry status: Completed."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
    - "Original extracted designKind: single_arm_trial_registry."
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: The registry sets a pregnancy/perinatal boundary for mindfulness-sleep claims and identifies cognitive arousal and engagement endpoints.
potentialMurphEndpoints:
  - insomnia severity
  - pre-sleep cognitive arousal
  - depressive symptoms
  - sleep effort/engagement context
protocolTakeaway: Use as perinatal clinical context only; avoid generalizing pregnancy-tailored PUMAS to silent unguided bedtime meditation.
murphTakeaway: "PUMAS is a therapist-led perinatal insomnia program with behavioral sleep strategies, not a low-touch silent meditation protocol."
studyDesign: "Completed open-label single-arm registry record; source references linked PUMAS publications, but registry has no posted results section."
modality: Pregnancy-tailored therapist-led telemedicine mindfulness sleep program.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - Single-arm open-label registry record; no posted registry results section.
  - Pregnancy-specific safety and sleep physiology limit generalization.
  - "PUMAS combines behavioral sleep strategies, therapist contact, and mindfulness, so meditation-only effects are not isolated."
  - "Registry detailed description notes a planned enrollment of 50, while the extracted enrollment field reports 12 actual participants."
populationMismatch: "Pregnant women with prenatal insomnia, not general adult users; therapist-led perinatal program rather than self-guided silent bedtime practice."
interventionOrExposure: "Perinatal Understanding of Mindful Awareness for Sleep (PUMAS): six weekly telemedicine therapist sessions combining behavioral sleep strategies with mindfulness meditation and pregnancy-tailored content."
comparatorOrControl: No comparator; single-group open-label trial.
durationOrFollowUp: Six telemedicine sessions during pregnancy with pretreatment and posttreatment assessment after treatment completion or about 10 weeks after starting treatment.
endpoints:
  - Insomnia Severity Index
  - Edinburgh Postnatal Depression Scale
  - Presleep Arousal Scale cognitive factor
  - patient engagement
  - homework adherence
  - treatment satisfaction
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event results were posted in the extracted payload.
sourceFindings:

  -
    findingId: finding:clinicaltrials-nct04443959-2026-04-27/registry-context
    sourceKey: source_artifact:clinicaltrials-nct04443959-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct04443959-2026-04-27
    findingKind: context
    population: "Pregnant women aged 18 to 40 years, 18-30 weeks gestation at enrollment, with ISI score 11 or higher."
    exposure: "Perinatal Understanding of Mindful Awareness for Sleep (PUMAS): six weekly telemedicine therapist sessions combining behavioral sleep strategies with mindfulness meditation and pregnancy-tailored content."
    outcome: "Pregnancy-tailored intervention design, insomnia/depression/cognitive-arousal endpoints, and publication linkage."
    summary: "Registry record for 12 pregnant women receiving six PUMAS telemedicine sessions; useful for perinatal boundary and cognitive-arousal endpoint context, but no registry results were posted and the intervention is multi-component and supervised."
    evidenceUse:
      - context
      - measurement
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Registry record for 12 pregnant women receiving six PUMAS telemedicine sessions; useful for perinatal boundary and cognitive-arousal endpoint context, but no registry results were posted and the intervention is multi-component and supervised.

**Why it matters:** The registry sets a pregnancy/perinatal boundary for mindfulness-sleep claims and identifies cognitive arousal and engagement endpoints.

**Potential experiment signals:** insomnia severity, pre-sleep cognitive arousal, depressive symptoms, sleep effort/engagement context.

**Protocol takeaway:** Use as perinatal clinical context only; avoid generalizing pregnancy-tailored PUMAS to silent unguided bedtime meditation.

**Claim use:** `context-only`.
