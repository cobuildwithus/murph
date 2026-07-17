---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:sleep-baseline-observation
slug: families/sleep-baseline-observation
title: Sleep Baseline Observation
summary: A brief sleep diary before changing anything, used to separate sleep-onset, maintenance, timing, and daytime-function patterns without turning normal variation into a problem.
status: field-testing
quality: usable
aliases:
  - sleep baseline
  - baseline sleep diary
  - observe sleep before changing it
  - sleep pattern check
categories:
  - sleep
  - sleep-diary
  - baseline-observation
  - low-burden
familyKind: modality
canonicalMechanism: prospective_sleep_pattern_observation
relations:
  - type: primary_biomarker
    target: biomarker:sleep-quality
  - type: secondary_biomarker
    target: biomarker:sleep-onset-latency
  - type: secondary_biomarker
    target: biomarker:wake-after-sleep-onset
  - type: secondary_biomarker
    target: biomarker:daytime-sleepiness
  - type: cites
    target: source_artifact:pmid-22294820
  - type: cites
    target: source_artifact:pmid-33164742
  - type: cites
    target: source_artifact:pmid-29734997
  - type: cites
    target: source_artifact:pmid-28162150
  - type: cites
    target: source_artifact:pmid-26414989
---

Sleep Baseline Observation is a **non-runnable planning workflow**, not an intervention and not a reason to create an experiment run. Use it when the problem is still vague or when changing several things at once would erase the signal.

For 3–7 mornings, keep the log cheaper than the sleep problem. Record only:

- prospectively intended sleep-attempt time and actual sleep-attempt time,
- estimated time to fall asleep,
- estimated total time awake after first falling asleep and before the final awakening,
- final wake time and whether waking felt too early,
- subjective sleep quality and daytime sleepiness,
- naps and one short note for unusual stress, illness, pain, alcohol, caffeine, travel, caregiving, or schedule disruption.

Do not add supplements, medication changes, sleep restriction, a rigid wake target, or several new bedtime rules during the observation window. Wearable data can add context, but quiet wakefulness and awakenings are often misclassified; a brief same-wording diary remains important.

At review, choose the lightest useful next step:

- **No stable problem:** leave it alone or stop tracking.
- **Mostly trouble starting sleep:** consider one onset or bedtime-transition intervention.
- **Mostly repeated or early waking:** use the sleep-maintenance workflow and check its care gates.
- **Mostly schedule drift:** consider a circadian-timing workflow that protects sleep opportunity.
- **Mostly daytime impairment:** prioritize adequate sleep and clinical assessment over another self-experiment.

Stop the baseline early if tracking increases sleep effort, anxiety, or compulsive score checking. Dangerous sleepiness, drowsy driving, breathing pauses or gasping, severe mood change, or persistent functional impairment should move out of self-tracking and toward appropriate care.
