---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct03567434-alcohol-and-neural-cardiovascular-control-2026-04-26
slug: sources/alcohol-abstinence/clinicaltrials-gov-nct03567434-alcohol-and-neural-cardiovascular-control-2026-04-26
title: Alcohol and Neural Cardiovascular Control in Binge Drinkers
summary: ClinicalTrials.gov registry record NCT03567434 anchors the randomized crossover evening alcohol/fluid-control protocol studying sympathetic activity, baroreflex function, HRV, and sleep in binge drinkers; it is protocol context rather than results evidence.
status: draft
quality: usable
aliases:
- NCT03567434
categories:
- alcohol-abstinence
- sleep-autonomic-wearable-context
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
source:
  kind: external_protocol
  title: Alcohol and Neural Cardiovascular Control in Binge Drinkers
  authors: ClinicalTrials.gov registry record
  year: 2018
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Alcohol and Neural Cardiovascular Control in Binge Drinkers. NCT03567434. https://clinicaltrials.gov/study/NCT03567434
  url: https://clinicaltrials.gov/study/NCT03567434
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT03567434
    titleHash: fe8cc178cefbb3aba3b7b6c14c6a2ee6365866d4d995573a035d09e674dac715
    url: https://clinicaltrials.gov/study/NCT03567434
  canonicalUrl: https://clinicaltrials.gov/study/NCT03567434
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized crossover clinical trial registry record
  populationLabel: Male and female binge drinkers
  durationLabel: Evening alcohol and fluid-control placebo crossover protocol; registry results not extracted
  aggregateRole: context
  cohortKey: nct03567434-alcohol-neural-cardiovascular-control-binge-drinkers
evidenceBucket: Sleep, autonomic, wearable, and acute-alcohol measurement context
whyItMatters: Connects several sleep/autonomic alcohol-exposure papers to a registered protocol and clarifies planned endpoints.
potentialMurphEndpoints:
- sympathetic activity
- baroreflex function
- heart rate
- HRV
- sleep
protocolTakeaway: Use as registry/protocol provenance only; do not use as efficacy evidence unless results are separately extracted from publications.
murphTakeaway: The registry reinforces that alcohol-sleep-autonomic endpoints are preplanned research targets in binge-drinker protocols.
studyDesign: Trial registry record
modality: Evening alcohol/placebo crossover protocol
population: Male and female binge drinkers.
interventionOrExposure: Evening alcohol exposure in a randomized crossover protocol.
comparatorOrControl: Fluid-control/placebo condition.
durationOrFollowUp: Crossover overnight protocol; exact follow-up varies by registered procedures and publications.
endpoints:
- sympathetic activity
- baroreflex function
- heart rate
- HRV
- sleep
effectEstimatesOrDirection: No registry results were extracted; the record states the study evaluates evening alcohol effects on sympathetic activity and baroreflex function.
adverseEventsOrSafetyNotes: Registry context for a controlled alcohol-exposure study; no extracted adverse events.
limitations: Registry record is not a peer-reviewed results paper; enrollment/results fields were not fully extracted here.
populationMismatch: Binge-drinker acute-exposure protocol, not voluntary short-term abstinence.
directnessToProtocol: same_mechanism
claimUse: context-only
sourceFindings:
-
  findingId: finding:clinicaltrials-gov-nct03567434-alcohol-and-neural-cardiovascular-control-2026-04-26-registry-alcohol-neural-cardiovascular-control
  sourceKey: source_artifact:clinicaltrials-gov-nct03567434-alcohol-and-neural-cardiovascular-control-2026-04-26
  findingKind: context
  population: Male and female binge drinkers
  exposure: Randomized crossover evening alcohol versus fluid-control placebo protocol
  outcome: sympathetic activity; baroreflex function; HRV; sleep
  summary: The registry identifies a randomized crossover protocol evaluating evening alcohol effects on sympathetic activity and baroreflex function in binge drinkers, without extracted results.
  evidenceUse:
  - context
  - measurement
  - safety
murphV1Priority: Medium
pdfRightsStatus: unknown
---


This source is included for **Sleep, autonomic, wearable, and acute-alcohol measurement context**.

**Findings:** No registry results were extracted; the record states the study evaluates evening alcohol effects on sympathetic activity and baroreflex function.

**Why it matters:** Connects several sleep/autonomic alcohol-exposure papers to a registered protocol and clarifies planned endpoints.

**Potential experiment signals:** sympathetic activity, baroreflex function, heart rate, HRV, sleep.

**Protocol takeaway:** Use as registry/protocol provenance only; do not use as efficacy evidence unless results are separately extracted from publications.

**Claim use:** `context-only`.

**Directness:** `same_mechanism`.

**Population mismatch:** Binge-drinker acute-exposure protocol, not voluntary short-term abstinence.

**Limitations and safety notes:** Registry record is not a peer-reviewed results paper; enrollment/results fields were not fully extracted here. Registry context for a controlled alcohol-exposure study; no extracted adverse events.
