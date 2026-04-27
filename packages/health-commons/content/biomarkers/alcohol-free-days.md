---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:alcohol-free-days
slug: biomarkers/alcohol-free-days
title: Alcohol-Free Days
summary: A daily count of calendar days completed without alcoholic beverages during a chosen alcohol-free challenge; it is the primary adherence signal, not a standalone health outcome.
status: draft
quality: usable
aliases:
- abstinent days
- alcohol abstinent days
- alcohol-free day count
- dry days
- verified abstinent days
categories:
- alcohol-abstinence
- adherence
- self-report
- behavior-change
measurementContexts:
- daily_self_report
- calendar_day_log
- optional_breathalyser_verification
- end_of_challenge_review
unit: days
interpretationFrame:
  principle: 'Use alcohol-free days as the challenge adherence denominator: compare planned days with completed days and read lapses as context for planning, not moral failure.'
  caveat: This count does not prove physiologic benefit. It can be affected by recall, ambiguous low-alcohol products, unlogged drinks, social pressure, and whether the day boundary is defined consistently.
biomarker:
  shortName: Alcohol-free days
  displayName: Alcohol-Free Days
  unit: days
  valuePrecision: 0
  direction:
    desired: higher
    label: Target is the planned number of alcohol-free days for the selected challenge.
    nuance: Completion is useful adherence data; a lower number can still identify cues, friction, withdrawal-like symptoms, or support needs.
  privateMetricBindings:
  -
    source: browser_vault_metric
    domain: body_state
    metric: alcoholFreeDay
    unit: boolean
    preferred: true
  -
    source: browser_vault_signal_summary
    accessor: alcohol.alcoholFreeDays
    unit: days
  trendDefaults:
    latestWindowDays: 30
    comparisonWindowDays: 30
    minimumPoints: 7
    aggregation: mean
  measurement:
    bestContext: Daily same-day logging, optionally verified with breathalyser in research or clinical contexts, is more reliable than end-of-month recall alone.
    howToMeasure:
    - Define the day boundary before day 1, such as wake-to-sleep or midnight-to-midnight.
    - Record yes/no for alcohol-free status every day during baseline and challenge windows.
    - If alcohol was consumed, record beverage type, estimated amount, context, craving, symptoms, and whether the plan continues, pauses, shortens, or restarts.
    - Keep ambiguous low-alcohol products visible in notes rather than silently treating them as either success or failure.
    - Review completed days against the selected target of 7, 14, or 30 days.
    confounders:
    - forgotten or delayed logging
    - ambiguous non-alcoholic products
    - unmeasured alcohol content
    - social desirability
    - different day-boundary definitions
    - research verification versus self-guided logging
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
-
  type: cites
  target: source_artifact:pmid-32021698
-
  type: cites
  target: source_artifact:pmid-39489405
-
  type: cites
  target: source_artifact:pmid-26690637
-
  type: cites
  target: source_artifact:pmid-41110619
claims:
-
  claimId: adherence-endpoint
  type: design_guardrail
  text: For a short alcohol-free challenge, alcohol-free days are the primary adherence endpoint and should be interpreted before physiologic or subjective secondary signals.
  strength: high
  sourceKeys:
  - source_artifact:pmid-32021698
  - source_artifact:pmid-39489405
  caveats:
  - This is adherence evidence, not proof that the completed challenge improved health.
-
  claimId: campaign-and-one-month-fit
  type: evidence_scope
  text: One-month and Dry-January-style temporary abstinence sources support tracking completion and post-challenge plans, but they do not make every 7-, 14-, and 30-day variant evidence-equivalent.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-26690637
  - source_artifact:pmid-41110619
  - source_artifact:pmid-32021698
  caveats:
  - Campaign cohorts are self-selected and may include social support, media framing, or motivations that differ from a private Murph self-experiment.
---


## How Murph uses this

Alcohol-free days are the primary adherence signal for the Short-Term Alcohol Abstinence Challenge. They answer the basic question: did the selected 7-, 14-, or 30-day window actually remove alcoholic beverages?

## What it does not show

This metric does not diagnose alcohol-use disorder, estimate withdrawal risk, or prove liver, sleep, cardiovascular, mood, or glucose benefit. Pair it with safety symptoms, craving, sleep, social context, and the end-of-challenge off-ramp plan.
