---
schemaVersion: murph.frontmatter.health-library.v1
docType: health_library
entityType: biomarker
slug: resting-heart-rate
title: Resting Heart Rate
summary: A behavior-sensitive biomarker that sits between cardiovascular efficiency, sleep recovery, training adaptation, and long-run health risk.
status: draft-v0.1
missionSlug: 100-healthy-years
domainSlugs:
  - cardiovascular-health
  - sleep-recovery
  - fitness-longevity
goalTemplateSlugs:
  - lower-resting-heart-rate
  - improve-sleep-consistency
  - increase-deep-sleep
  - improve-cardiorespiratory-fitness
relatedBiomarkerSlugs:
  - heart-rate-variability
  - deep-sleep
  - sleep-consistency
  - respiratory-rate
  - vo2-max
  - blood-pressure
  - activity-strain
measurementContexts:
  -
    slug: awake-seated-clinical
    label: Awake seated clinical
    summary: Standard clinic pulse while calm, awake, and seated.
    unit: bpm
  -
    slug: morning-manual-pulse
    label: Morning manual pulse
    summary: Manual pulse taken shortly after waking before activity.
    unit: bpm
  -
    slug: nighttime-lowest-wearable
    label: Lowest nighttime wearable RHR
    summary: Lowest sleep-derived resting heart rate captured overnight by a wearable.
    unit: bpm
  -
    slug: nighttime-average-wearable
    label: Average nighttime wearable RHR
    summary: Overnight average resting heart rate derived from a wearable sleep window.
    unit: bpm
defaultMeasurementContextSlug: nighttime-lowest-wearable
heroStats:
  -
    label: Adult awake resting range
    value: 60-100 bpm
    context: general adult clinical range
    sourceSlugs:
      - mayo-heart-rate-normal
  -
    label: Oura average lowest nighttime RHR
    value: 57 bpm
    context: tracked wearable cohort
    sourceSlugs:
      - oura-resting-heart-rate
  -
    label: Median weekly fluctuation
    value: ~3 bpm
    context: within-person wearable variation
    sourceSlugs:
      - wearable-rhr-variation-study
referenceSets:
  -
    label: Adult clinical normal
    measurementContextSlug: awake-seated-clinical
    population: general adults
    kind: clinical-normal
    benchmark: 60-100 bpm
    note: Very fit athletes can sit closer to 40 bpm.
    sourceSlugs:
      - mayo-heart-rate-normal
  -
    label: US adult seated average
    measurementContextSlug: awake-seated-clinical
    population: US adults
    kind: population-mean
    benchmark: ~72 bpm overall
    note: Men cluster around 70-71 bpm and women around 73-76 bpm depending on age band.
    sourceSlugs:
      - cdc-resting-pulse-reference
  -
    label: Sleep-derived wearable cohort
    measurementContextSlug: nighttime-lowest-wearable
    population: tracked wearable cohorts
    kind: wearable-mean
    benchmark: 57-66 bpm depending on device and cohort
    note: Fenland sleep RHR and Project Baseline watch values run lower than seated clinic pulse.
    sourceSlugs:
      - fenland-fitness-study
      - project-baseline-wearable-study
baselineInsights:
  -
    title: Personal baseline beats population norms
    body: Different people can have wildly different normal RHR values, while each person's own weekly pattern is usually much tighter.
    stat: Up to 70 bpm between-person spread
    sourceSlugs:
      - wearable-rhr-variation-study
  -
    title: Weekly noise still matters
    body: Even when a value is still inside a normal range, a sustained move up from your own baseline can mean more than the raw number alone.
    stat: 80% stayed under a 10 bpm maximum weekly swing
    sourceSlugs:
      - wearable-rhr-variation-study
mechanisms:
  -
    title: Cardiac efficiency
    body: At rest, a lower heart rate often means the body is meeting the same demand with fewer beats because stroke volume and cardiovascular efficiency are better.
    sourceSlugs:
      - hemodynamic-profile-review
  -
    title: Lower cardiac workload
    body: Higher resting heart rate tracks with higher blood pressure, greater arterial stiffness, and higher cardiac workload in hemodynamic work.
    sourceSlugs:
      - hemodynamic-profile-review
signalInsights:
  -
    title: Fitness signal
    body: Higher RHR is consistently associated with lower cardiorespiratory fitness in population studies.
    sourceSlugs:
      - fenland-fitness-study
  -
    title: Recovery and autonomic signal
    body: Oura and WHOOP both treat sleep-derived RHR as a recovery input, especially when it moves against personal baseline.
    sourceSlugs:
      - oura-resting-heart-rate
      - whoop-recovery-rhr
  -
    title: Acute stress signal
    body: Alcohol, poor sleep, late meals, illness, dehydration, travel, and hard evening training can all move nighttime RHR quickly.
    sourceSlugs:
      - oura-resting-heart-rate
      - whoop-recovery-rhr
healthspanEvidence:
  -
    title: Mortality association
    body: Higher resting heart rate is linked with higher all-cause and cardiovascular mortality in observational data, which is exactly why it belongs in a healthspan graph.
    stat: +9% all-cause mortality per 10 bpm
    sourceSlugs:
      - rhr-mortality-meta-analysis
guardrails:
  -
    title: Lower is not automatically better
    body: Very low values can be good in trained athletes, but a persistently low RHR with dizziness, fainting, or shortness of breath deserves clinical attention.
    sourceSlugs:
      - mayo-heart-rate-normal
  -
    title: Watch deviations from your normal
    body: Oura flags both unusually high and unusually low nighttime values relative to baseline because both can signal stress or incomplete recovery.
    sourceSlugs:
      - oura-resting-heart-rate
sourceSlugs:
  - mayo-heart-rate-normal
  - cdc-resting-pulse-reference
  - wearable-rhr-variation-study
  - hemodynamic-profile-review
  - fenland-fitness-study
  - project-baseline-wearable-study
  - rhr-mortality-meta-analysis
  - exercise-rhr-meta-analysis
  - oura-resting-heart-rate
  - whoop-recovery-rhr
---
# Resting Heart Rate

Resting heart rate is one of the most useful simple biomarkers in the system
because it sits at the intersection of cardiovascular efficiency, autonomic
balance, sleep recovery, training adaptation, and long-term health risk.

There is no single universal good number. The useful questions are which
measurement context you are using, what is normal for this person, whether the
value is trending the way you want over time, and what other signals moved with
it at the same time.

For a wearable-first health graph, the most valuable default is lowest
nighttime resting heart rate, because it is available often, behaves like a
recovery signal, and responds to sleep, alcohol, illness, meal timing, heat,
and training load fast enough to support self-experimentation.
