---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:improve-chronic-insomnia
slug: improve-chronic-insomnia
title: Improve Chronic Insomnia
summary: Use first-line behavioral treatment to make sleep less effortful and improve daytime function over time.
status: field-testing
quality: usable
aliases:
  - get chronic insomnia under control
  - treat long-term insomnia
categories:
  - goals
  - sleep
  - insomnia
goal:
  category: sleep
  parentGoalKey: goal_template:sleep-better
  outcomeKind: symptom
  goalPhrase: improve my chronic insomnia
  successSignals:
    - id: lower_insomnia_burden
      kind: symptom
      label: Less difficulty starting or maintaining sleep
    - id: better_daytime_function
      kind: function
      label: Better daytime function and less sleep distress
    - id: consistent_treatment_practice
      kind: behavior
      label: Consistent use of an evidence-based treatment plan
  evidenceSourceKeys:
    - source_artifact:pmid-33164742
    - source_artifact:pmid-27136449
  workflow:
    kind: care_support
    ownerSkillIds:
      - sleep-improvement
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me improve my chronic insomnia.
  indexable: true
safety:
  cautionLevel: moderate
---

Chronic insomnia is more than the occasional bad night. It is repeated trouble falling asleep, staying asleep, or waking too early despite the chance to sleep, with a real effect on your days. The best-supported first-line treatment is **cognitive behavioral therapy for insomnia (CBT-I)**, which retrains the relationship between sleep, schedule, bed, and worry and goes well beyond sleep-hygiene tips.

## What to do

- Look for CBT-I through a trained clinician, a health system, or a validated digital program. A typical course is structured and time-limited.
- Keep a simple sleep diary for one to two weeks: time into bed, estimated time asleep, final wake time, and daytime function. Estimates are enough.
- Keep a consistent wake time, and don't stretch time in bed far beyond what you actually sleep; lying awake in bed can strengthen insomnia.
- Reserve the bed for sleep and sex. If you are awake and getting frustrated, get up for a quiet, dim activity and return when sleepy.
- Work on the thoughts that keep sleep effort high: catastrophic predictions about tomorrow, clock checking, and treating every wake-up as a failure.
- Review caffeine, alcohol, naps, pain, reflux, breathing symptoms, restless legs, medications, and mood with whoever guides treatment.

## A simple plan

Start with a two-week baseline diary and one stable wake time. Work out your rough average sleep time, but don't put yourself on aggressive sleep restriction from an internet formula. In formal CBT-I, the sleep window is adjusted carefully to consolidate sleep, then widened as sleep becomes more efficient.

While you arrange care, use the lowest-risk pieces: keep wake time steady, go to bed when sleepy rather than merely tired, stop checking the clock, and use a calm out-of-bed reset when frustrated. Set aside a short daytime slot for problem-solving so bedtime isn't the first moment worries get attention.

Review progress weekly. If time awake is falling and daytime sleepiness stays manageable, hold the routine. If sleep becomes severely restricted, daytime safety worsens, or the plan creates intense anxiety, pause and get professional guidance.

## How to know it is working

Improvement may show up as less time awake, fewer long awakenings, more confidence that sleep will return, and better days. Total sleep does not always rise right away; some people first notice more consolidated sleep and less distress.

Use weekly averages, not single nights. Wearables can estimate timing, but they can mistake quiet wakefulness for sleep; a diary and daytime outcomes are more useful for setting the sleep window and other CBT-I decisions.

## If you get stuck

Sleep hygiene alone is often not enough. If you have already darkened the room and dropped afternoon coffee, more rules just add sleep effort. Seek actual CBT-I rather than endlessly tinkering with the bedroom.

Insomnia can coexist with sleep apnea, restless legs, chronic pain, trauma, depression, anxiety, menopause symptoms, and medication effects, and treating one does not automatically fix the others. If you take prescription sleep medicine, discuss any change with the prescriber; abrupt changes can cause rebound symptoms or other problems.

## A quick note

Sleep-window restriction needs clinician guidance if you have bipolar disorder, seizure risk, untreated severe sleep apnea, parasomnias, high fall risk, pregnancy, or safety-sensitive work. Get urgent help for suicidal thoughts, dangerous sleepiness, or a markedly reduced need for sleep with unusual energy.

## Sources

- [AASM guideline for behavioral and psychological treatment of chronic insomnia](https://jcsm.aasm.org/doi/10.5664/jcsm.8986)
- [American College of Physicians guideline for chronic insomnia](https://pubmed.ncbi.nlm.nih.gov/27136449/)
- [2025 VA/DoD insomnia and sleep apnea guideline](https://www.healthquality.va.gov/guidelines/CD/insomnia/index.asp)
