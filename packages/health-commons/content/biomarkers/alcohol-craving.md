---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:alcohol-craving
slug: biomarkers/alcohol-craving
title: Alcohol Craving
summary: A subjective urge-to-drink or refusal-confidence signal tracked during an alcohol-free challenge; useful for planning support, but not guaranteed to improve.
status: draft
quality: usable
aliases:
- urge to drink
- alcohol urge
- drinking craving
- drinking-refusal self-efficacy
- DRSE
- temptation to drink
categories:
- alcohol-abstinence
- subjective-outcome
- behavior-change
- craving
measurementContexts:
- daily_self_report
- end_of_challenge_review
- social_context_log
- craving_trigger_log
unit: 0-10 rating or validated questionnaire score
interpretationFrame:
  principle: 'Track craving as a planning signal: look for triggers, time-of-day patterns, social contexts, and whether refusal confidence improves or worsens.'
  caveat: Craving may not fall during short abstinence, can fluctuate by stress and cue exposure, and should not be used to judge success by itself.
biomarker:
  shortName: Craving
  displayName: Alcohol Craving
  unit: 0-10 rating
  valuePrecision: 0
  direction:
    desired: lower
    label: Lower, less frequent, or more manageable urges are useful, but stable craving with successful safety and adherence can still be informative.
    nuance: Craving is subjective and context-sensitive. High or escalating urges are a support-planning signal, especially when paired with distress or unsafe substitution.
  privateMetricBindings:

  -
    source: browser_vault_metric
    domain: body_state
    metric: craving
    unit: 0-10
    preferred: true
  -
    source: browser_vault_signal_summary
    accessor: alcohol.craving
    unit: 0-10
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 5
    aggregation: median
  measurement:
    bestContext: Daily same-scale rating plus brief notes about trigger, setting, stress, social friction, and action taken.
    howToMeasure:
    - Choose one simple scale, such as 0 = no urge and 10 = strongest urge you can imagine.
    - Log at the same time each day and also after high-risk situations.
    - Record cue, stress level, social context, replacement behavior, and whether the urge passed, escalated, or led to drinking.
    - At the end, review both craving and confidence to refuse alcohol; they can move differently.
    - Escalate to support if craving is intense, persistent, distressing, paired with unsafe behavior, or makes self-guided abstinence feel unsafe.
    confounders:
    - stress
    - sleep loss
    - social cues
    - pain
    - negative mood
    - hunger
    - replacement substances
    - evening routine
    - work events
    - relationship conflict
    - withdrawal-like symptoms
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
-
  type: cites
  target: source_artifact:doi-10.1080-07347324.2024.2419616
-
  type: cites
  target: source_artifact:pmid-29668736
-
  type: cites
  target: source_artifact:pmid-30016350
-
  type: cites
  target: source_artifact:pmid-28957493
claims:
-
  claimId: craving-not-guaranteed-to-improve
  type: evidence_scope
  text: A one-month abstinence-program source supports tracking refusal self-efficacy and craving, but extracted results do not justify a blanket claim that craving reliably decreases.
  strength: moderate
  sourceKeys:
  - source_artifact:doi-10.1080-07347324.2024.2419616
  caveats:
  - The extracted source is preliminary and analyzes successful completers, so selection bias is likely.
-
  claimId: craving-context-patterns
  type: design_guardrail
  text: Craving can vary by stress, time of day, and physiologic context, so daily ratings should be paired with trigger and setting notes rather than interpreted as a single stable trait.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-29668736
  - source_artifact:pmid-30016350
  caveats:
  - Moderate-heavy consumer studies are adjacent context; they are not direct efficacy tests of the challenge.
---


## How to use this

Craving helps explain adherence, lapses, and the off-ramp plan. It is most useful when logged with the trigger, setting, replacement behavior, and whether the urge passed.

## What it does not show

A lower craving score is not required to call the experiment informative, and a high score does not mean failure. Persistent or escalating craving is a reason to add support or seek care.
