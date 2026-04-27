---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct06348082-2026-04-27
slug: sources/pre-sleep-downshift-practices/clinicaltrials-nct06348082-2026-04-27
title: "Project Women's Insomnia Sleep Health Equity Study (Project WISHES)"
summary: "Trial-registry context for Project Women's Insomnia Sleep Health Equity Study (Project WISHES); included for source identity, protocol details, endpoint planning, and claim-boundary tracking, not direct silent-bedtime efficacy."
status: draft
quality: usable
aliases:
  - Project WISHES
  - Implementing Mindfulness Practice to Advance Sleep Health Equity Among Black Women
  - NCT06348082
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
  title: Implementing Mindfulness Practice to Advance Sleep Health Equity Among Black Women
  authors: ClinicalTrials.gov
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Implementing Mindfulness Practice to Advance Sleep Health Equity Among Black Women. Identifier NCT06348082. Snapshot source key dated 2026-04-27.
  url: https://clinicaltrials.gov/study/nct06348082
sourceKind: trial_registry
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: nct06348082
    titleHash: 05fdcca944fd11c2c8acdca851bb195ec088e08052f68547cf820c506988b0c8
    url: https://clinicaltrials.gov/study/nct06348082
  canonicalUrl: https://clinicaltrials.gov/study/nct06348082
researchEvidence:
  designKind: expert_protocol
  designLabel: Recruiting pragmatic Hybrid Type 1 effectiveness/implementation registry record for MBTI versus waitlist
  participantCount: 340
  participantCountKind: approximate
  populationLabel: Self-identified Black women aged 18-70 with insomnia disorder in a pragmatic implementation trial.
  durationLabel: 6 weekly MBTI sessions with 12-week follow-up and specified home-practice dose.
  aggregateRole: primary
  cohortKey: cohort-clinicaltrials-nct06348082-2026-04-27
  notes:
    - "Registry status: Recruiting."
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
    - "Original extracted designKind: randomized_controlled_trial_registry."
    - "Original extracted participantCountKind: estimated."
evidenceBucket: trial_registries_and_unresolved_protocols
whyItMatters: "The registry is valuable for current equity-focused MBTI implementation, explicit home-practice dose burden, waitlist design, and acceptability/feasibility metrics."
potentialMurphEndpoints:
  - insomnia severity
  - sleep-onset latency criterion context
  - wake after sleep onset criterion context
  - perceived stress
  - acceptability/feasibility
  - adherence/fidelity
protocolTakeaway: Use as current protocol and dose-burden context only; no efficacy claim should be made while results are pending.
murphTakeaway: The 30-45 minute daily home-practice expectation is much heavier than a brief pre-bed silent practice and should inform burden comparisons.
studyDesign: Recruiting pragmatic randomized effectiveness/implementation registry protocol; no results yet.
modality: Community-engaged online/group MBTI implementation trial delivered by registered nurses with community-health-worker support.
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - Recruiting registry protocol with no results.
  - "MBTI is multi-component, guided, and clinically implemented with social-needs/community supports."
  - "Population is self-identified Black women with insomnia, not a broad general-adult sample."
  - High home-practice dose does not match a short silent bedtime protocol.
populationMismatch: Self-identified Black women with insomnia in an implementation trial; not a broad Murph self-experiment cohort or low-burden bedtime practice.
interventionOrExposure: "Mindfulness-based therapy for insomnia administered in six weekly sessions; sessions include guided formal meditation, mindfulness concepts/practice, behavioral strategies for sleep, and home mindfulness practice expectations of 30-45 minutes/day at least 5 days during intervention, followed by 20 minutes/day until 12-week final follow-up."
comparatorOrControl: Waitlist no-intervention control.
durationOrFollowUp: "Baseline, week 6, and week 12 outcomes; 6-week intervention followed by lower-dose home practice until final follow-up."
endpoints:
  - Insomnia Severity Index
  - Perceived Stress Scale
  - Acceptability of Intervention Measure
  - Feasibility of Intervention Measure
  - treatment fidelity via mindfulness-intervention adherence/competence checklist
effectEstimatesOrDirection: No registry-posted comparative effect estimate was available in the extracted source payload.
adverseEventsOrSafetyNotes: No registry adverse-event results were posted because the trial is recruiting and results are unavailable in the extracted payload.
sourceFindings:
  -
    findingId: finding:clinicaltrials-nct06348082-2026-04-27/registry-context
    sourceKey: source_artifact:clinicaltrials-nct06348082-2026-04-27
    extractedFromArtifactId: art-clinicaltrials-nct06348082-2026-04-27
    findingKind: context
    population: "Self-identified Black women aged 18 to 70 with ICSD3 insomnia disorder, ISI greater than 7, and sleep-onset latency or wake time after sleep onset at least 31 minutes on at least 3 nights per week for at least 3 months."
    exposure: "Mindfulness-based therapy for insomnia administered in six weekly sessions; sessions include guided formal meditation, mindfulness concepts/practice, behavioral strategies for sleep, and home mindfulness practice expectations of 30-45 minutes/day at least 5 days during intervention, followed by 20 minutes/day until 12-week final follow-up."
    outcome: "Current pragmatic trial design, home-practice dose burden, insomnia/stress endpoints, and implementation metrics."
    summary: "Recruiting registry protocol for 340 self-identified Black women randomized to MBTI or waitlist, with six sessions and home practice of 30-45 minutes/day during intervention then 20 minutes/day until week 12; use for dose-burden and implementation context only because no results are available."
    evidenceUse:
      - context
      - measurement
murphV1Priority: High
pdfRightsStatus: not_applicable_registry
---
This source is included for **trial_registries_and_unresolved_protocols**.

**Findings:** Recruiting registry protocol for 340 self-identified Black women randomized to MBTI or waitlist, with six sessions and home practice of 30-45 minutes/day during intervention then 20 minutes/day until week 12; use for dose-burden and implementation context only because no results are available.

**Why it matters:** The registry is valuable for current equity-focused MBTI implementation, explicit home-practice dose burden, waitlist design, and acceptability/feasibility metrics.

**Potential experiment signals:** insomnia severity, sleep-onset latency criterion context, wake after sleep onset criterion context, perceived stress, acceptability/feasibility, adherence/fidelity.

**Protocol takeaway:** Use as current protocol and dose-burden context only; no efficacy claim should be made while results are pending.

**Claim use:** `context-only`.
