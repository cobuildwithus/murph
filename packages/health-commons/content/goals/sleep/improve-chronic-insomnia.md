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

Chronic insomnia is more than an occasional bad night. It is repeated difficulty falling asleep, staying asleep, or waking too early despite having the opportunity to sleep, with a meaningful effect on daytime life. The best-supported first-line treatment is **cognitive behavioral therapy for insomnia (CBT-I)**. It retrains the relationship between sleep, schedule, bed, and worry; it is not simply a list of sleep-hygiene tips.

## What to do

- Look for access to CBT-I through a trained clinician, health system, or validated digital program. A usual course is structured and time-limited.
- Keep a simple sleep diary for one to two weeks: time into bed, estimated time asleep, final wake time, and daytime function. Estimates are enough.
- Use a consistent wake time and avoid extending time in bed far beyond the amount you actually sleep. Too much awake time in bed can strengthen insomnia.
- Reserve the bed for sleep and sex. If you are awake and increasingly frustrated, leave for a quiet dim activity and return when sleepy.
- Work on the thoughts that keep sleep effort high: catastrophic predictions about tomorrow, clock checking, and treating every wake-up as a failure.
- Review caffeine, alcohol, naps, pain, reflux, breathing symptoms, restless legs, medications, and mood with the person guiding treatment.

## A simple plan

Begin with a two-week baseline diary and one stable wake time. Calculate approximate average sleep time, but do not impose aggressive sleep restriction on yourself from an internet formula. In formal CBT-I, the sleep window is adjusted carefully to consolidate sleep and then expanded as sleep becomes more efficient.

While arranging care, use the lowest-risk core pieces: keep wake time steady, go to bed when sleepy rather than merely tired, stop clock checking, and use a calm out-of-bed reset when wakefulness becomes frustrating. Schedule a brief daytime period for problem-solving so bedtime is not the first moment worries receive attention.

Review progress weekly. If time awake is falling and daytime sleepiness remains manageable, hold the routine. If sleep becomes severely restricted, daytime safety worsens, or the plan creates intense anxiety, pause and get professional guidance.

## How to know it is working

Improvement may show up as less time awake, fewer long awakenings, more confidence that sleep will return, and better daytime function. Total sleep does not always rise immediately; some people first experience more consolidated sleep and less distress.

Use weekly averages rather than one night. Wearables can estimate timing, but they can misclassify quiet wakefulness as sleep and should not determine the sleep window. A diary and daytime outcomes are usually more useful for CBT-I decisions.

## If you get stuck

Sleep hygiene alone is often insufficient for chronic insomnia. If you have already darkened the room and stopped afternoon coffee, adding more rules can create more sleep effort. Seek actual CBT-I rather than endlessly optimizing the bedroom.

Insomnia can coexist with sleep apnea, restless legs, chronic pain, trauma, depression, anxiety, menopause symptoms, and medication effects. Treating one does not automatically resolve the others. If you use prescription sleep medicine, discuss changes with the prescriber; abrupt changes can cause rebound symptoms or other problems.

## A quick note

Sleep-window restriction needs clinician guidance when you have bipolar disorder, seizure risk, untreated severe sleep apnea, parasomnias, high fall risk, pregnancy, or safety-sensitive work. Get urgent help for suicidal thoughts, dangerous sleepiness, or a markedly reduced need for sleep with unusual energy.

## Sources

- [AASM guideline for behavioral and psychological treatment of chronic insomnia](https://jcsm.aasm.org/doi/10.5664/jcsm.8986)
- [American College of Physicians guideline for chronic insomnia](https://pubmed.ncbi.nlm.nih.gov/27136449/)
- [2025 VA/DoD insomnia and sleep apnea guideline](https://www.healthquality.va.gov/guidelines/CD/insomnia/index.asp)
