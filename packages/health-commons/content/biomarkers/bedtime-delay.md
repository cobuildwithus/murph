---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:bedtime-delay
slug: biomarkers/bedtime-delay
title: Bedtime Delay
summary: The nonnegative minutes between a prospectively intended sleep-attempt time and the actual sleep attempt, recorded as zero when the attempt begins on time or earlier.
status: field-testing
quality: usable
aliases:
  - bedtime delay minutes
  - minutes late to bed
  - intended bedtime delay
  - delayed sleep attempt
categories:
  - sleep
  - bedtime-procrastination
  - behavior-timing
  - sleep-diary
relations:
  - type: related_protocol
    target: protocol_variant:bedtime-transition/standard-tiny-fallback-transition
  - type: cites
    target: source_artifact:pmid-24997168
  - type: cites
    target: source_artifact:pmid-22294820
measurementContexts:
  - morning_self_report
  - prospective_bedtime_plan
  - sleep_diary
unit: minutes
interpretationFrame:
  principle: Compare repeated same-person delay against a bedtime intention set before the late-evening decision point, then check that sleep opportunity and daytime function are not worse.
  caveat: An external constraint, a changed plan, clock or timezone errors, uncertainty about lights-out, or redefining the intended bedtime after the fact can make the number misleading.
biomarker:
  shortName: Bedtime delay
  displayName: Bedtime Delay
  unit: minutes
  valuePrecision: 0
  privateMetricBindings:
    - source: metric
      metricKey: bedtime-delay
      role: primary
      unit: minutes
  direction:
    desired: lower_or_stable
    label: Lower or stable delay is useful when sleep opportunity and next-day function are preserved.
    nuance: Zero is not a universal bedtime target. It means the person's own prospectively chosen sleep-attempt time was met or beaten on that night.
  trendDefaults:
    latestWindowDays: 7
    comparisonWindowDays: 7
    minimumPoints: 3
    aggregation: median
  measurement:
    bestContext: Set the intended sleep-attempt time before the evening transition, then record the actual attempt and the nonnegative difference the next morning.
    howToMeasure:
      - Define sleep attempt as the point when the person starts trying to sleep; record getting into bed or lights-out separately when either happens earlier.
      - When the actual attempt begins after the intended time, record the elapsed minutes across midnight when needed.
      - Record 0 when the attempt begins at or before the intended time; do not use negative values as a reward.
      - Flag a changed plan, work, caregiving, pain, illness, travel, or another external constraint instead of silently moving the intended time after the fact.
      - Read the delay beside sleep-onset latency, sleep quality, sleep opportunity, and daytime sleepiness.
    confounders:
      - retrospectively changed bedtime intention
      - external schedule constraint
      - caregiving or on-call interruption
      - pain or illness
      - travel or timezone change
      - clock uncertainty
      - changed definition of sleep attempt
communityOutcomeSummary:
  state: insufficient_data
  minimumCohortSize: 30
  placeholder: No comparable community outcome is available yet for bedtime delay.
---

Bedtime delay measures whether the **transition into a sleep attempt** happened when intended. It is not sleep-onset latency: someone can begin trying to sleep on time and still take a while to fall asleep.

The useful definition is `max(0, actual sleep-attempt time - prospectively intended sleep-attempt time)`, measured in elapsed minutes with midnight handled normally. The intention must be set before the late-evening decision point; moving it afterward erases the behavior being tested.

This is a behavior-timing outcome, not proof of better sleep or a diagnosis of bedtime procrastination. Keep it only when lower delay agrees with adequate sleep opportunity, tolerable burden, and stable or better next-day function.
