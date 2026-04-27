---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-alcohol-dependence-assessment-2014-10-21
slug: sources/alcohol-abstinence/nice-alcohol-dependence-assessment-2014-10-21
title: 'Alcohol-use disorders: diagnosis, assessment and management of harmful drinking and alcohol dependence'
summary: Complements CG100 by addressing assessment of dependence and assisted-withdrawal planning rather than self-directed abstinence challenge efficacy.
status: draft
quality: usable
aliases:
- source_artifact:nice-alcohol-dependence-assessment-2014-10-21
- nice-alcohol-dependence-assessment-2014-10-21
- candidate:withdrawal-safety-screening:003
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
  title: 'Alcohol-use disorders: diagnosis, assessment and management of harmful drinking and alcohol dependence'
  authors: National Institute for Health and Care Excellence (NICE)
  year: 2011
  journal: NICE Clinical Guideline CG115
  citation: 'National Institute for Health and Care Excellence (NICE). Alcohol-use disorders: diagnosis, assessment and management of harmful drinking and alcohol dependence. NICE Clinical Guideline CG115. 2011.'
  url: https://www.nice.org.uk/guidance/cg115
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: 34acfad505e2f3dc757a9ce97344b430c43dc26e467170f0d24f9c6780813f30
    url: https://www.nice.org.uk/guidance/cg115
  canonicalUrl: https://www.nice.org.uk/guidance/cg115
researchEvidence:
  designKind: guideline
  designLabel: Clinical guideline
  populationLabel: People with harmful drinking or alcohol dependence.
  durationLabel: Assisted withdrawal planning; fixed-dose medication regimens commonly 7 to 10 days in guideline context.
  aggregateRole: synthesis
  cohortKey: nice-alcohol-dependence-assessment-2014-10-21
  notes:
  - Guideline safety thresholds and level-of-care criteria; no challenge efficacy estimate.
evidenceBucket: withdrawal risk and safety screening
whyItMatters: Complements CG100 by addressing assessment of dependence and assisted-withdrawal planning rather than self-directed abstinence challenge efficacy.
potentialMurphEndpoints:
- dependence severity
- assisted withdrawal setting
- withdrawal symptoms
- clinician guidance boundary
protocolTakeaway: Use this source for withdrawal-risk screening and acute safety boundaries only; do not cite it as efficacy evidence for a 7-, 14-, or 30-day alcohol-free challenge.
murphTakeaway: Use to set onboarding exclusions for severe dependence, very high intake, prior seizures/DT, benzodiazepine withdrawal, and significant comorbidity. Does not support benefit claims for the alcohol-free protocol; it defines when the protocol should defer to care.
studyDesign: Clinical guideline
modality: Alcohol withdrawal risk screening and safety guidance
claimUse: safety-only
sourceFindings:
-
  findingId: finding:alcohol-abstinence/nice-alcohol-dependence-assessment-2014-10-21
  sourceKey: source_artifact:nice-alcohol-dependence-assessment-2014-10-21
  extractedFromArtifactId: art_nice-alcohol-dependence-assessment-2014-10-21
  findingKind: safety
  population: People with harmful drinking or alcohol dependence.
  exposure: Assessment, assisted withdrawal planning, and management of harmful drinking and dependence.
  outcome: dependence severity, assisted withdrawal setting, withdrawal symptoms, clinician guidance boundary
  summary: NICE CG115 addresses diagnosis, assessment, and management of harmful drinking and alcohol dependence, including assisted-withdrawal planning and criteria for inpatient/residential withdrawal such as high daily intake, severe dependence, epilepsy, withdrawal seizures, delirium tremens history, concurrent benzodiazepine withdrawal, or important comorbidities.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
interventionOrExposure: Assessment, assisted withdrawal planning, and management of harmful drinking and dependence.
comparatorOrControl: Community versus inpatient/residential assisted withdrawal depending on risk.
durationOrFollowUp: Assisted withdrawal planning; fixed-dose medication regimens commonly 7 to 10 days in guideline context.
endpoints:
- dependence severity
- assisted withdrawal setting
- withdrawal symptoms
- clinician guidance boundary
effectEstimatesOrDirection: Guideline safety thresholds and level-of-care criteria; no challenge efficacy estimate.
adverseEventsOrSafetyNotes: NICE CG115 addresses diagnosis, assessment, and management of harmful drinking and alcohol dependence, including assisted-withdrawal planning and criteria for inpatient/residential withdrawal such as high daily intake, severe dependence, epilepsy, withdrawal seizures, delirium tremens history, concurrent benzodiazepine withdrawal, or important comorbidities.
limitations:
- Clinical guideline, not challenge trial.
- Thresholds are care-planning tools and do not substitute for clinician judgment.
populationMismatch: People with harmful drinking or alcohol dependence, not low-risk community challenge participants.
directnessToProtocol: general_guideline
claimUseBoundary: Safety-only/context boundary. This source should not be promoted into direct protocol efficacy claims.
artifactCandidates:
- art_nice-alcohol-dependence-assessment-2014-10-21
---


This source is included for **Withdrawal-risk screening and acute safety guidance**.

**Findings:** NICE CG115 addresses diagnosis, assessment, and management of harmful drinking and alcohol dependence, including assisted-withdrawal planning and criteria for inpatient/residential withdrawal such as high daily intake, severe dependence, epilepsy, withdrawal seizures, delirium tremens history, concurrent benzodiazepine withdrawal, or important comorbidities.

**Why it matters:** Complements CG100 by addressing assessment of dependence and assisted-withdrawal planning rather than self-directed abstinence challenge efficacy.

**Potential experiment signals:** dependence severity, assisted withdrawal setting, withdrawal symptoms, clinician guidance boundary.

**Protocol takeaway:** Use as safety-screening or escalation evidence only. It does not support efficacy claims for 7-, 14-, or 30-day alcohol-free variants.

**Claim use:** `safety-only`.
