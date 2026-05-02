---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:alcohol-intake
slug: biomarkers/alcohol-intake
title: Alcohol Intake
summary: A self-reported count of alcoholic drinks, units, or grams of ethanol before, during, and after an alcohol-free challenge; useful for context and off-ramp planning rather than as a moral score.
status: draft
quality: usable
aliases:
- alcohol consumption
- drinks per week
- standard drinks
- UK units
- ethanol grams
- AUDIT-C drinking pattern
categories:
- alcohol-abstinence
- self-report
- behavior-change
- risk-context
measurementContexts:
- baseline_drinking_log
- daily_self_report
- AUDIT_C_context
- post_challenge_review
unit: standard drinks or alcohol units
interpretationFrame:
  principle: Use the same unit system across baseline and follow-up, and prioritize transparent context over precision when exact beverage alcohol content is unknown.
  caveat: Drink size, alcohol by volume, under-reporting, recall delay, binge pattern, and local standard-drink definitions can all change interpretation.
biomarker:
  shortName: Alcohol intake
  displayName: Alcohol Intake
  unit: standard drinks or units
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Lower intake or more alcohol-free days may be a goal after the challenge, but the protocol itself focuses on a defined alcohol-free interval.
    nuance: A post-challenge increase, rebound, or unsafe pattern is a reason to review the off-ramp or seek support rather than to treat the experiment as a success.
  privateMetricBindings:

  -
    source: browser_vault_metric
    domain: body_state
    metric: drinks
    unit: drinks
    preferred: true
  -
    source: browser_vault_signal_summary
    accessor: alcohol.drinksPerWeek
    unit: drinks/week
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 30
    minimumPoints: 7
    aggregation: mean
  measurement:
    bestContext: Daily beverage logging with a consistent standard-drink, unit, or grams-of-ethanol convention, plus a brief baseline and follow-up review.
    howToMeasure:
    - 'Choose one unit convention before baseline: standard drinks, UK units, or grams of ethanol.'
    - During baseline, record drinks daily rather than reconstructing the week at the end.
    - Record binge-like patterns and high-risk contexts separately from weekly totals.
    - After the challenge, log at least the first week of drinking or continued abstinence so the off-ramp is visible.
    - Use AUDIT-C-style questions as screening context when a brief structured intake summary is needed, not as a substitute for clinical evaluation.
    confounders:
    - different standard-drink definitions
    - pour size
    - ABV variation
    - recall bias
    - under-reporting
    - social desirability
    - binge pattern hidden by weekly totals
    - post-challenge rebound
    - travel or holidays
relations:
-
  type: related_protocol
  target: protocol_variant:alcohol-abstinence/short-term-alcohol-abstinence
-
  type: parent_family
  target: experiment_family:alcohol-abstinence
-
  type: cites
  target: source_artifact:pmid-9738608
-
  type: cites
  target: source_artifact:pmid-3360951
-
  type: cites
  target: source_artifact:pmid-7334801
-
  type: cites
  target: source_artifact:pmid-26690637
claims:
-
  claimId: structured-consumption-context
  type: design_guardrail
  text: Baseline and follow-up alcohol-intake logs are needed to interpret a temporary abstinence challenge because completion alone does not show what happens to drinking after the challenge ends.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-3360951
  - source_artifact:pmid-7334801
  - source_artifact:pmid-26690637
  caveats:
  - Older voluntary abstinence studies and self-selected campaign cohorts may not generalize to all users.
-
  claimId: audit-c-context-not-diagnosis
  type: evidence_scope
  text: AUDIT-C-style consumption questions can provide compact drinking-pattern context, but a self-experiment page should not be used to diagnose or rule out alcohol-use disorder.
  strength: high
  sourceKeys:
  - source_artifact:pmid-9738608
  caveats:
  - Diagnosis and treatment planning require appropriate clinical assessment, especially when withdrawal risk or dependence is possible.
---


## How to use this

Alcohol intake gives the challenge a baseline and off-ramp context: what was usual before the alcohol-free window, whether any drinks occurred during it, and what happened afterward.

## What it does not show

A weekly total can hide binge pattern, withdrawal risk, medication interactions, pregnancy risk, or clinical alcohol-use disorder. Use it with the safety screen, withdrawal symptom log, and clinician referral rules.
