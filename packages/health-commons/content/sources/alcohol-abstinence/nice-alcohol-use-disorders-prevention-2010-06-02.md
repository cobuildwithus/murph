---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:nice-alcohol-use-disorders-prevention-2010-06-02
slug: sources/alcohol-abstinence/nice-alcohol-use-disorders-prevention-2010-06-02
title: 'Alcohol-use disorders: prevention'
summary: NICE PH24 frames alcohol prevention around population policy, screening, brief advice, extended brief intervention, and referral; it does not test short-term abstinence challenges.
status: draft
quality: usable
aliases:
- 'Alcohol-use disorders: prevention'
- nice-alcohol-use-disorders-prevention-2010-06-02
categories:
- alcohol-abstinence
- alcohol-reduction-comparator
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: guideline
  title: 'Alcohol-use disorders: prevention'
  authors: National Institute for Health and Care Excellence (NICE)
  year: 2010
  journal: NICE Public Health Guideline PH24
  citation: 'National Institute for Health and Care Excellence. Alcohol-use disorders: prevention. NICE Public Health Guideline PH24. Published June 2, 2010. https://www.nice.org.uk/guidance/ph24'
  url: https://www.nice.org.uk/guidance/ph24
sourceIdentity:
  identityKind: guideline
  canonicalIdBasis: url
  identifiers:
    titleHash: f6747a0c33e25054d883635bf6cf9f316135a2777f93d219d1a46b25225c3a23
    url: https://www.nice.org.uk/guidance/ph24
  canonicalUrl: https://www.nice.org.uk/guidance/ph24
researchEvidence:
  designKind: guideline
  designLabel: Public-health guideline
  populationLabel: People over 10 years old in population, community, education, criminal-justice, and health-care settings
  durationLabel: Guideline recommendations; not an intervention follow-up study
  aggregateRole: context
  cohortKey: nice-ph24-2010-alcohol-use-disorders-prevention
evidenceBucket: general alcohol public-health guideline context
whyItMatters: Sets a public-health boundary around screening, brief advice, and referral for hazardous or harmful drinking without making direct claims about short abstinence challenges.
potentialMurphEndpoints:
- AUDIT-C or AUDIT screening context
- weekly alcohol intake
- referral/safety flagging
protocolTakeaway: Use as guideline context for screening and referral language only; do not cite as evidence that a 7-, 14-, or 30-day alcohol-free challenge improves outcomes.
murphTakeaway: NICE PH24 supports careful framing around screening, brief advice, and escalation for harmful drinking, not direct abstinence-challenge efficacy.
studyDesign: Public-health guideline
modality: Alcohol-risk screening and brief intervention policy context
population: General public-health population including children and young people over 10 years old, adults, and people encountered in services.
interventionOrExposure: Public-health policies, alcohol screening, brief advice, extended brief interventions, and referral pathways for hazardous or harmful drinking.
comparatorOrControl: Not applicable; guideline recommendations rather than a comparative trial.
durationOrFollowUp: Guideline recommendations; not an intervention follow-up study
endpoints:
- screening uptake
- brief advice
- alcohol-related harm prevention
- referral pathways
effectEstimatesOrDirection: NICE recommends coordinated prevention, price/availability and marketing policy actions, screening for hazardous or harmful drinking, brief advice for adults, and referral or extended interventions when indicated. No abstinence-challenge efficacy estimate is provided.
adverseEventsOrSafetyNotes: Emphasizes identification of hazardous or harmful drinking and referral where needed; not a safety trial.
limitations: Guideline synthesis and policy recommendations; not direct evidence for voluntary 7-, 14-, or 30-day abstinence challenges.
populationMismatch: Population-wide public-health scope is broader than self-selected Murph users undertaking short alcohol-free challenges.
directnessToProtocol: general_guideline
claimUse: context-only
sourceFindings:
-
  findingId: finding:nice-alcohol-use-disorders-prevention-screening-context
  sourceKey: source_artifact:nice-alcohol-use-disorders-prevention-2010-06-02
  findingKind: context
  population: General public-health population including children and young people over 10 years old, adults, and people encountered in services.
  exposure: Public-health policies, alcohol screening, brief advice, extended brief interventions, and referral pathways for hazardous or harmful drinking.
  outcome: screening uptake; brief advice; alcohol-related harm prevention; referral pathways
  summary: NICE PH24 frames alcohol prevention around population policy, screening, brief advice, extended brief intervention, and referral; it does not test short-term abstinence challenges.
  evidenceUse:
  - context
murphV1Priority: High
pdfRightsStatus: permission_required
---


This source is included for **Alcohol-reduction comparator reviews and public-health guideline context**.

**Findings:** NICE recommends coordinated prevention, price/availability and marketing policy actions, screening for hazardous or harmful drinking, brief advice for adults, and referral or extended interventions when indicated. No abstinence-challenge efficacy estimate is provided.

**Why it matters:** Sets a public-health boundary around screening, brief advice, and referral for hazardous or harmful drinking without making direct claims about short abstinence challenges.

**Potential experiment signals:** AUDIT-C or AUDIT screening context, weekly alcohol intake, referral/safety flagging.

**Protocol takeaway:** Use as guideline context for screening and referral language only; do not cite as evidence that a 7-, 14-, or 30-day alcohol-free challenge improves outcomes.

**Claim use:** `context-only`.

**Directness:** `general_guideline`.

**Population mismatch:** Population-wide public-health scope is broader than self-selected Murph users undertaking short alcohol-free challenges.

**Limitations and safety notes:** Guideline synthesis and policy recommendations; not direct evidence for voluntary 7-, 14-, or 30-day abstinence challenges. Emphasizes identification of hazardous or harmful drinking and referral where needed; not a safety trial.
