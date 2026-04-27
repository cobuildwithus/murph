---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct04951466-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct04951466-2026-04-27
title: Mindfulness Based Therapy for Insomnia in Black Women
summary: "Trial-registry context for Mindfulness Based Therapy for Insomnia in Black Women; included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - MBTI in Black Women
  - Mindfulness-based therapy for insomnia in Black women
  - NCT04951466
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
  title: Mindfulness Based Therapy for Insomnia in Black Women
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Mindfulness Based Therapy for Insomnia in Black Women. Identifier NCT04951466. Snapshot source key dated 2026-04-27.
  url: https://clinicaltrials.gov/study/nct04951466
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct04951466
    titleHash: 7dab5b13b802aa360500e1fd3731b1a13fc2be03887cd8dcce357acb2c4fb061
    url: https://clinicaltrials.gov/study/nct04951466
  canonicalUrl: https://clinicaltrials.gov/study/nct04951466
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Completed pilot RCT registry record for MBTI versus healthy lifestyle education in Black women
  participantCount: 30
  participantCountKind: reported
  populationLabel: Self-identified Black women aged 25-45 with insomnia disorder.
  durationLabel: 8 weekly 2-hour sessions with week-10 follow-up.
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct04951466-2026-04-27
  notes:
    - "Registry status: Completed."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "The registry preserves underserved-population design, feasibility, actigraphy/sleep-diary, stress, and inflammatory biomarker endpoints."
potentialMurphEndpoints:
  - sleep-onset latency
  - sleep efficiency
  - wake after sleep onset
  - total sleep time
  - insomnia severity
  - perceived stress
  - daytime sleepiness
  - sleep quality
  - cortisol/CRP/cytokine context
protocolTakeaway: Use as equity/population-specific clinical context only; do not generalize it to a direct silent bedtime meditation claim.
murphTakeaway: "This trial is important for Black women with insomnia and endpoint equity, but the intervention is high-contact clinical MBTI."
studyDesign: Completed 30-participant randomized pilot registry record; no registry results were posted in the extracted payload.
modality: Supervised MBTI group intervention with behavioral sleep strategies.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - Registry source without posted results in the extracted payload.
  - Small pilot sample.
  - Population-specific trial context and supervised MBTI with behavioral sleep strategies differ from silent self-directed bedtime meditation.
populationMismatch: "Self-identified Black women with insomnia aged 25-45, not a broad general adult sample; supervised clinical MBTI rather than a simple bedtime practice."
interventionOrExposure: "Mindfulness-based therapy for insomnia, 2-hour weekly sessions for 8 weeks including mindfulness meditation and behavioral sleep strategies."
comparatorOrControl: "Time-and-attention healthy lifestyle education including health promotion, disease prevention/screening, healthy eating, physical activity, communication, and sleep hygiene."
durationOrFollowUp: 8-week intervention with baseline and week-10 outcomes.
endpoints:
  - retention
  - enrollment
  - fidelity
  - Insomnia Severity Index
  - sleep onset latency
  - sleep efficiency and quality
  - wake after sleep onset
  - total sleep time
  - Perceived Stress Scale
  - cortisol
  - CRP
  - cytokines IL-1β/IL-6/TNF-α
  - PHQ-9
  - Epworth Sleepiness Scale
  - DBAS
  - Sleep Hygiene Practice Scale
  - trait anxiety
  - FFMQ
  - PSQI
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event results were posted in the extracted payload.
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct04951466-2026-04-27/registry-context
    sourceKey: source_artifact:clinicaltrials-nct04951466-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct04951466-2026-04-27
    findingKind: context
    population: "Self-identified Black women aged 25 to 45, English-speaking, meeting DSM-5/ICSD3 insomnia criteria with ISI greater than 7."
    exposure: "Mindfulness-based therapy for insomnia, 2-hour weekly sessions for 8 weeks including mindfulness meditation and behavioral sleep strategies."
    outcome: "Pilot RCT design, underserved-population boundary, feasibility outcomes, sleep and biomarker endpoints."
    summary: "Completed registry record for 30 self-identified Black women randomized to MBTI or healthy lifestyle education; useful for equity, feasibility, and biomarker endpoint context, but no registry results were posted and the intervention is supervised MBTI."
    evidenceUse:
      - context
      - measurement
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Completed registry record for 30 self-identified Black women randomized to MBTI or healthy lifestyle education; useful for equity, feasibility, and biomarker endpoint context, but no registry results were posted and the intervention is supervised MBTI.

**Why it matters:** The registry preserves underserved-population design, feasibility, actigraphy/sleep-diary, stress, and inflammatory biomarker endpoints.

**Potential experiment signals:** sleep-onset latency, sleep efficiency, wake after sleep onset, total sleep time, insomnia severity, perceived stress, daytime sleepiness, sleep quality, cortisol/CRP/cytokine context.

**Protocol takeaway:** Use as equity/population-specific clinical context only; do not generalize it to a direct silent bedtime meditation claim.

**Claim use:** `context-only`.
