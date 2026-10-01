---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:sleep-better
slug: sleep-better
title: Sleep Better
summary: Improve the sleep outcomes that matter most by finding the main barrier and building a small routine around it.
status: field-testing
quality: usable
aliases:
  - improve my sleep
  - get better sleep
categories:
  - goals
  - sleep
goal:
  category: sleep
  outcomeKind: function
  goalPhrase: sleep better
  successSignals:
    - id: better_sleep_experience
      kind: function
      label: Sleep feels more restful and reliable
    - id: better_daytime_function
      kind: function
      label: Better alertness, mood, or energy during the day
    - id: sustainable_sleep_routine
      kind: behavior
      label: A sleep routine that fits real life
  evidenceSourceKeys:
    - source_artifact:pmid-29073398
    - source_artifact:pmid-37684151
    - source_artifact:pmid-33164742
  workflow:
    kind: general_plan
    ownerSkillIds:
      - sleep-improvement
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me sleep better.
  indexable: true
safety:
  cautionLevel: low
---

Better sleep can mean falling asleep faster, staying asleep, getting enough total sleep, waking at a useful time, or feeling more alert by day. Pick the part that is actually failing. One focused change helps more than ten “perfect sleep” habits at once.

## What to do

- **Name the main problem.** Too short, too late, broken, hard to start, or just unrefreshing? Pick one outcome for the next two weeks.
- **Protect enough opportunity.** Most adults need at least seven hours of sleep regularly. Work backward from a realistic wake time and reserve that much.
- **Anchor the day.** Keep wake time fairly steady, get daylight after waking, move regularly, and don't let weekends reverse the weekday schedule.
- **Make the evening easier to leave.** Set a stop point for work and scrolling, dim the lights, and pick a short repeatable transition: washing up, reading, stretching, or setting out tomorrow's essentials.
- **Keep the major disruptors visible.** Late caffeine, alcohol, large meals, pain, congestion, hot flashes, medications, and a noisy or hot room can each matter. Don't assume they all apply to you.
- **Treat the bed as a cue for sleep.** If you're awake and getting frustrated, a quiet, dim reset out of bed beats fighting for sleep there.

## A simple plan

For the first three nights, change nothing. Record rough bedtime, final wake time, the biggest sleep problem, and how functional you felt the next day. Don't chase perfect accuracy.

Then choose one lever for eleven nights:

1. If sleep is too short, add 30 minutes of protected opportunity.
2. If timing is erratic, anchor wake time within about an hour.
3. If falling asleep is the problem, set a clear work cutoff and use one low-stimulation reset when stuck awake.
4. If awakenings are the problem, address the most obvious trigger: noise, reflux, alcohol, pain, temperature, or breathing symptoms.
5. If sleep is long enough but unrefreshing, get snoring, breathing pauses, restless legs, medication effects, and daytime sleepiness evaluated.

Keep the change small enough to survive a busy week. A five-minute routine that happens beats a 60-minute one you abandon.

## How to know it is working

Pick one night signal and one day signal. Night: time to fall asleep, long awakenings, or typical duration. Day: morning restfulness, afternoon sleepiness, mood, or concentration. Judge the weekly pattern, not one night.

Wearables help with timing and trends, but their sleep-stage estimates vary by device and person. If a score rises while you feel worse, trust how you feel. If it drops after a normal late night but the week is otherwise good, leave it alone.

## If you get stuck

When the first change doesn't help, ask whether you picked the right problem. More time in bed can worsen insomnia if it becomes more awake time. An earlier bedtime fails when the body clock isn't ready. A beautiful bedroom can't treat sleep apnea. Change the hypothesis, not just the intensity.

Persistent insomnia is best treated with cognitive behavioral therapy for insomnia, which goes well beyond sleep hygiene. Loud snoring, gasping, repeated leg discomfort, severe nightmares, chronic pain, mood symptoms, and medication effects each need their own path.

## A quick note

Get prompt help for dangerous daytime sleepiness, especially while driving. See a clinician for breathing pauses, chest symptoms, major mood changes, or sleep problems that stay frequent and impairing despite a reasonable self-care attempt.

## Sources

- [American Academy of Sleep Medicine and Sleep Research Society: adult sleep duration](https://jcsm.aasm.org/doi/10.5664/jcsm.4758)
- [National Sleep Foundation consensus statement on sleep regularity](https://pubmed.ncbi.nlm.nih.gov/37684151/)
- [AASM guideline for behavioral treatment of chronic insomnia](https://jcsm.aasm.org/doi/10.5664/jcsm.8986)
