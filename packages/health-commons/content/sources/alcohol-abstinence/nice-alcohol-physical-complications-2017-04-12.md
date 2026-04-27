---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-alcohol-physical-complications-2017-04-12
slug: sources/alcohol-abstinence/nice-alcohol-physical-complications-2017-04-12
title: 'Alcohol-use disorders: diagnosis and management of physical complications'
summary: Major UK guideline for acute withdrawal and alcohol-related physical complication boundaries; useful for stop conditions and referral thresholds.
status: draft
quality: usable
aliases:
- source_artifact:nice-alcohol-physical-complications-2017-04-12
- nice-alcohol-physical-complications-2017-04-12
- candidate:withdrawal-safety-screening:002
categories:
- alcohol-abstinence
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: guideline
  title: 'Alcohol-use disorders: diagnosis and management of physical complications'
  authors: National Institute for Health and Care Excellence (NICE)
  year: 2010
  journal: NICE Clinical Guideline CG100
  citation: 'National Institute for Health and Care Excellence (NICE). Alcohol-use disorders: diagnosis and management of physical complications. NICE Clinical Guideline CG100. 2010.'
  url: https://www.nice.org.uk/guidance/cg100
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: f276724d2a9323d87aaf7358a1a4db184a0f14a6d502ae58d4df2514142573e9
    url: https://www.nice.org.uk/guidance/cg100
  canonicalUrl: https://www.nice.org.uk/guidance/cg100
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline
  populationLabel: Adults and young people with physical health problems caused or partly caused by alcohol-use disorder.
  durationLabel: Acute withdrawal and complication management; not a 7-, 14-, or 30-day challenge duration study.
  aggregateRole: synthesis
  cohortKey: nice-alcohol-physical-complications-2017-04-12
  notes:
  - Guideline safety recommendations; no efficacy estimate for abstinence challenges.
evidenceBucket: withdrawal risk and safety screening
whyItMatters: Major UK guideline for acute withdrawal and alcohol-related physical complication boundaries; useful for stop conditions and referral thresholds.
potentialMurphEndpoints:
- acute withdrawal
- delirium tremens
- seizures
- physical complications
- clinician guidance boundary
protocolTakeaway: Use this source for withdrawal-risk screening and acute safety boundaries only; do not cite it as efficacy evidence for a 7-, 14-, or 30-day alcohol-free challenge.
murphTakeaway: Use as a hard safety boundary source for prior seizures, delirium tremens, acute confusion, severe symptoms, and need for urgent medical assessment. Does not support any efficacy claim for short-term abstinence; it only governs safe referral and stop conditions.
studyDesign: Clinical guideline
modality: Alcohol withdrawal risk screening and safety guidance
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/nice-alcohol-physical-complications-2017-04-12
  sourceKey: source_artifact:nice-alcohol-physical-complications-2017-04-12
  extractedFromArtifactId: art_nice-alcohol-physical-complications-2017-04-12
  findingKind: safety
  population: Adults and young people with physical health problems caused or partly caused by alcohol-use disorder.
  exposure: Diagnosis and management of acute alcohol withdrawal and alcohol-related physical complications.
  outcome: acute withdrawal, delirium tremens, seizures, physical complications, clinician guidance boundary
  summary: NICE CG100 gives acute alcohol-withdrawal and physical-complication guidance, including referral/admission boundaries for people at high risk of seizures or delirium tremens and warnings against abrupt reduction in dependent drinkers without care.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Diagnosis and management of acute alcohol withdrawal and alcohol-related physical complications.
comparatorOrControl: Not applicable.
durationOrFollowUp: Acute withdrawal and complication management; not a 7-, 14-, or 30-day challenge duration study.
endpoints:
- acute withdrawal
- delirium tremens
- seizures
- physical complications
- clinician guidance boundary
effectEstimatesOrDirection: Guideline safety recommendations; no efficacy estimate for abstinence challenges.
adverseEventsOrSafetyNotes: NICE CG100 gives acute alcohol-withdrawal and physical-complication guidance, including referral/admission boundaries for people at high risk of seizures or delirium tremens and warnings against abrupt reduction in dependent drinkers without care.
limitations:
- Guideline scope is alcohol-related physical complications, not self-experimentation.
- Applies to clinical care pathways and requires clinician judgment.
populationMismatch: Targets people with alcohol-related physical complications and withdrawal risk, not low-risk community challengers.
directnessToProtocol: general_guideline
claimUseBoundary: Safety-only/context boundary. This source should not be promoted into direct protocol efficacy claims.
artifactCandidates:
- art_nice-alcohol-physical-complications-2017-04-12
---


This source is included for **Withdrawal-risk screening and acute safety guidance**.

**Findings:** NICE CG100 gives acute alcohol-withdrawal and physical-complication guidance, including referral/admission boundaries for people at high risk of seizures or delirium tremens and warnings against abrupt reduction in dependent drinkers without care.

**Why it matters:** Major UK guideline for acute withdrawal and alcohol-related physical complication boundaries; useful for stop conditions and referral thresholds.

**Potential experiment signals:** acute withdrawal, delirium tremens, seizures, physical complications, clinician guidance boundary.

**Protocol takeaway:** Use as safety-screening or escalation evidence only. It does not support efficacy claims for 7-, 14-, or 30-day alcohol-free variants.

**Claim use:** `safety-only`.
