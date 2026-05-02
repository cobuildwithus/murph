---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:alcohol-withdrawal-symptoms
slug: biomarkers/alcohol-withdrawal-symptoms
title: Alcohol Withdrawal Symptoms
summary: A safety-first symptom log for tremor, sweats, agitation, insomnia, nausea, confusion, hallucinations, seizures, and other warning signs after reducing or stopping alcohol.
status: draft
quality: usable
aliases:
- withdrawal symptoms
- acute alcohol withdrawal symptoms
- tremor after stopping alcohol
- delirium tremens warning signs
- PAWSS context
- CIWA-Ar context
categories:
- alcohol-abstinence
- safety
- clinical-boundary
- symptom-log
measurementContexts:
- pre_start_safety_screen
- daily_symptom_log
- urgent_stop_condition
- clinician_guided_context
unit: symptom severity or present/absent
interpretationFrame:
  principle: Treat withdrawal symptoms as a stop-condition and referral signal, not as a normal part of proving the challenge.
  caveat: A self-report symptom log cannot predict or manage severe withdrawal. Prior complicated withdrawal, dependence, heavy daily intake, seizure history, confusion, hallucinations, or worsening symptoms require clinician-guided care.
biomarker:
  shortName: Withdrawal symptoms
  displayName: Alcohol Withdrawal Symptoms
  unit: severity score or yes/no
  valuePrecision: 0
  direction:
    desired: lower
    label: Symptoms should be absent or mild and improving; escalation is a stop condition.
    nuance: 'The safest interpretation is conservative: new or worsening withdrawal-like symptoms mean pause the self-experiment and seek appropriate care.'
  privateMetricBindings:

  -
    source: browser_vault_metric
    domain: body_state
    metric: withdrawalSymptoms
    unit: ordinal
    preferred: true
  -
    source: browser_vault_signal_summary
    accessor: alcohol.withdrawalSymptoms
    unit: ordinal
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 1
    aggregation: median
  measurement:
    bestContext: Pre-start screening plus daily symptom checks during the first week; clinical tools belong in clinician-supervised settings, not as self-treatment instructions.
    howToMeasure:
    - Before starting, record any history of withdrawal seizure, delirium tremens, severe withdrawal, dependence, or needing alcohol to avoid symptoms.
    - Daily during days 1–7, check tremor, sweats, racing heart, severe anxiety, agitation, insomnia, nausea/vomiting, confusion, hallucinations, or seizure.
    - Use the highest symptom severity of the day for stop-condition logic.
    - Seek urgent help for seizure, confusion, hallucinations, delirium, fainting, chest pain, severe dehydration, repeated vomiting, severe agitation, or suicidal thoughts.
    - Do not attempt self-guided abrupt abstinence when risk is uncertain and clinically significant withdrawal is possible.
    confounders:
    - anxiety or panic unrelated to withdrawal
    - illness
    - caffeine or stimulant use
    - sleep deprivation
    - medication changes
    - dehydration
    - heavy daily intake
    - prior complicated withdrawal
    - active AUD treatment needs
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
-
  type: cites
  target: source_artifact:nice-alcohol-physical-complications-2017-04-12
-
  type: cites
  target: source_artifact:nice-alcohol-dependence-assessment-2014-10-21
-
  type: cites
  target: source_artifact:pmid-24657098
-
  type: cites
  target: source_artifact:pmid-25346507
-
  type: cites
  target: source_artifact:pmid-25999438
-
  type: cites
  target: source_artifact:pmid-32511109
claims:
-
  claimId: withdrawal-screening-first
  type: safety
  text: Withdrawal risk screening comes before a self-guided alcohol-free challenge; people with possible dependence, prior complicated withdrawal, or severe symptoms should use clinician-guided care rather than this wellness protocol.
  strength: high
  sourceKeys:
  - source_artifact:nice-alcohol-physical-complications-2017-04-12
  - source_artifact:nice-alcohol-dependence-assessment-2014-10-21
  - source_artifact:pmid-32511109
  caveats:
  - Guidelines are safety-boundary sources; they do not provide efficacy evidence for a short wellness abstinence challenge.
-
  claimId: risk-tools-clinical-context
  type: evidence_scope
  text: Alcohol-withdrawal prediction or severity tools can inform clinical risk context, but should not be turned into self-managed detox instructions.
  strength: high
  sourceKeys:
  - source_artifact:pmid-24657098
  - source_artifact:pmid-25346507
  - source_artifact:pmid-25999438
  caveats:
  - Validation settings and inpatient or medically ill populations may not match a community wellness self-experiment.
---


## How to use this

This is the protocol’s safety gate. Symptoms are not an efficacy endpoint. They decide whether the self-guided challenge should continue, pause, or be replaced by clinician-guided care.

## What it does not show

A low symptom score does not prove someone is safe to stop alcohol abruptly if their history suggests dependence or complicated withdrawal risk. Safety screening must stay conservative.
