---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:supplement-adherence
slug: biomarkers/supplement-adherence
title: Supplement Adherence
summary: A process metric for whether the planned supplement dose was actually taken during a self-experiment.
status: field-testing
quality: usable
aliases:
- dose adherence
- days taken
- supplement compliance
- collagen adherence
categories:
- manual-metric
- adherence
- supplement
- collagen-supplementation
measurementContexts:
- daily_manual_checkin
- weekly_review
unit: '% planned doses taken'
interpretationFrame:
  principle: A run is easier to interpret when planned doses are taken consistently or missed doses are clearly marked.
  caveat: High adherence does not prove efficacy, and low adherence can make both positive and negative results hard to interpret.
biomarker:
  shortName: Adherence
  displayName: Supplement Adherence
  unit: '%'
  valuePrecision: 0
  direction:
    desired: higher_or_stable
    label: Higher adherence improves interpretability.
    nuance: A perfect adherence score is not required, but missed doses and product switches should be visible.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 5
    aggregation: mean
  explainerCards:

  -
    title: What it is
    body: The percentage of planned daily supplement doses taken during the run.
  -
    title: Why it matters
    body: Without adherence, a supplement self-experiment cannot distinguish product response from inconsistent exposure.
  measurement:
    bestContext: Daily yes/no dose log with planned grams, actual grams, and product identity visible.
    howToMeasure:
    - Record whether the planned dose was taken.
    - Record actual grams if the dose differs from the plan.
    - Mark product switches, missed doses, travel, illness, and routine disruptions.
    confounders:
    - product switch
    - travel
    - illness
    - routine disruption
    - dose change
    - coingredient change
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: cites
  target: source_artifact:pmid-37717022
-
  type: cites
  target: source_artifact:pmid-40826844
-
  type: cites
  target: source_artifact:pmid-30609761
---

# Supplement Adherence

Supplement adherence is a process metric, not an efficacy outcome. It shows whether the planned exposure happened often enough for the selected HCP target to be interpretable.
