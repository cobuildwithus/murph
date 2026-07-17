---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:sleep-maintenance-tracking
slug: families/sleep-maintenance-tracking
title: Sleep Maintenance And Early-Waking Tracking
summary: A short morning record of awakenings, time awake after first falling asleep, early waking, and next-day function, used to decide whether the pattern is noise, situational, or worth clinical follow-up.
status: field-testing
quality: usable
aliases:
  - sleep maintenance tracking
  - middle of the night waking log
  - early waking log
  - wake after sleep onset tracking
  - WASO tracking
categories:
  - sleep
  - sleep-maintenance
  - early-waking
  - sleep-diary
  - low-burden
familyKind: modality
canonicalMechanism: prospective_sleep_maintenance_observation
relations:
  - type: primary_biomarker
    target: biomarker:wake-after-sleep-onset
  - type: secondary_biomarker
    target: biomarker:sleep-quality
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

Sleep Maintenance And Early-Waking Tracking is a **non-runnable planning workflow**. It characterizes what is happening before Murph suggests a behavioral experiment; it does not diagnose insomnia, sleep apnea, or another sleep disorder.

For up to 7 mornings, record one rough estimate rather than reconstructing the night minute by minute:

- number of remembered awakenings,
- total estimated minutes awake after first falling asleep and before the final awakening (WASO),
- final awakening and rise times, whether the final awakening felt earlier than intended, and any time spent trying to return to sleep after it,
- subjective sleep quality and daytime sleepiness,
- whether pain, breathing symptoms, reflux, temperature, noise, a partner or child, pets, nightmares, restless legs, urination, alcohol, medication, illness, or acute stress clearly interrupted sleep.

Use a wearable as supporting context only. Consumer sleep stages, overnight oxygen estimates, and an apparently normal sleep score cannot rule out a sleep disorder. Avoid checking the clock repeatedly during the night just to improve the log.

At review:

- **One or two disrupted nights with an obvious cause and safe daytime function:** usually leave it alone.
- **A repeatable environmental or schedule trigger:** change one reversible factor at a time.
- **Racing thoughts after waking:** consider a separate low-burden cognitive-offload or attention strategy only if it fits and does not increase arousal.
- **Persistent or impairing awakenings without a clear situational cause:** discuss the pattern with a clinician rather than stacking self-experiments.

Seek timely clinical help for loud snoring with witnessed pauses, choking or gasping, dangerous daytime sleepiness or drowsy driving, new chest or breathing symptoms, unusual nighttime behaviors or injuries, severe mood change, or major loss of function. A failed self-tracking workflow should never delay appropriate care.
