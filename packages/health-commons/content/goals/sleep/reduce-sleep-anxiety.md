---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-sleep-anxiety
slug: reduce-sleep-anxiety
title: Reduce Sleep Anxiety
summary: Lower the pressure, monitoring, and fear around sleep so bedtime becomes less of a performance test.
status: field-testing
quality: usable
aliases:
  - stop worrying about sleep
  - reduce bedtime anxiety
categories:
  - goals
  - sleep
  - insomnia
  - anxiety
goal:
  category: sleep
  outcomeKind: symptom
  goalPhrase: reduce my sleep anxiety
  successSignals:
    - id: lower_bedtime_anxiety
      kind: symptom
      label: Less anxiety before and during the sleep attempt
    - id: less_sleep_monitoring
      kind: behavior
      label: Less clock and tracker checking
    - id: easier_response_to_bad_nights
      kind: function
      label: A calmer response to imperfect nights
  evidenceSourceKeys:
    - source_artifact:pmid-33164742
    - source_artifact:pmid-19481481
  workflow:
    kind: general_plan
    ownerSkillIds:
      - sleep-improvement
      - stress-regulation
  startPrompt: Hey Murph, help me reduce my sleep anxiety.
  indexable: true
safety:
  cautionLevel: moderate
---

Sleep anxiety grows when sleep becomes a nightly test: checking the time, predicting disaster tomorrow, trying harder to switch off, inspecting the wearable score. That effort raises arousal and feeds the cycle. The aim is to make lying awake less threatening and rebuild confidence that your body can sleep unsupervised.

## What to do

- Get the clock out of sight. Knowing it is 2:13, 2:26, and 2:41 rarely helps.
- Stop treating the wearable as a morning verdict. If the score sets your mood before you know how you feel, hide sleep-stage details for two weeks.
- Set a short daytime “worry appointment”: write the problem, the next action, and when you'll revisit it.
- Go to bed when sleepy, not just because it's the planned time. Sleepiness is heavy eyelids and drifting attention; fatigue can feel exhausted but wired.
- If frustration builds in bed, go somewhere quiet and dim and do something neutral until sleepy.
- Practice a downshift skill without making it a sleep requirement. Slow breathing, progressive muscle relaxation, or calm audio can ease the moment even when sleep is slow.

## A simple plan

For two weeks, pick three rules: no visible clock, no sleep score until noon (or none at all), and one consistent response to long stretches awake. Before evening, spend ten minutes writing unfinished concerns and one next step for each; stop when the timer ends.

At bedtime, try a looser line: “I am making room for rest; sleep can arrive on its own.” When you catch a catastrophic prediction, write what you'd tell a friend: one poor night is unpleasant, but you've functioned after poor sleep before and can simplify tomorrow.

After a bad night, keep the day as normal as safety allows: daylight, meals, gentle movement, most of your plans. Nap briefly if needed for safety, but don't spend the day compensating.

## How to know it is working

Track anxiety and recovery, not just sleep. Rate pre-bed anxiety from 0 to 10, note any clock or tracker checks, and rate how you handled the next day. Progress can be the same sleep with less panic, before duration changes.

Look at weekly patterns, not single nights. The strongest signal: bedtime takes up less mental space, and a rough night no longer sets off days of repair behavior.

## If you get stuck

If relaxation becomes another task to perform perfectly, shorten it or drop it. If the sleep diary feeds the monitoring, record less. If reassurance seeking keeps growing (rechecking data, asking others if you look tired, researching consequences), set a boundary.

Persistent sleep anxiety is often part of chronic insomnia and responds well to CBT-I. Anxiety disorders, panic, trauma, obsessive-compulsive symptoms, and depression may need their own treatment, not a more elaborate bedtime routine.

## A quick note

Get prompt support if nighttime anxiety includes suicidal thoughts, severe panic you cannot manage, or a markedly reduced need for sleep with unusual energy or impulsivity. Do not change prescribed anxiety or sleep medicines without the prescriber.

## Sources

- [AASM guideline for behavioral and psychological treatment of chronic insomnia](https://jcsm.aasm.org/doi/10.5664/jcsm.8986)
- [VA/DoD 2025 patient guide to treating insomnia with behavior change](https://www.healthquality.va.gov/guidelines/CD/insomnia/index.asp)
