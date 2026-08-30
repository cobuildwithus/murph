---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:sleep-better-with-chronic-pain
slug: sleep-better-with-chronic-pain
title: Sleep Better With Chronic Pain
summary: Reduce the cycle in which pain disrupts sleep and poor sleep makes pain harder to manage the next day.
status: field-testing
quality: usable
aliases:
  - sleep better despite chronic pain
  - improve sleep with ongoing pain
categories:
  - goals
  - sleep
  - chronic-pain
goal:
  category: sleep
  parentGoalKey: goal_template:sleep-better
  outcomeKind: function
  goalPhrase: sleep better with chronic pain
  successSignals:
    - id: fewer_pain_awakenings
      kind: symptom
      label: Fewer or shorter pain-related awakenings
    - id: better_daytime_function
      kind: function
      label: Better function despite pain
    - id: stable_sleep_routine
      kind: behavior
      label: A stable sleep routine that does not worsen pain
  evidenceSourceKeys:
    - source_artifact:pmid-34900019
    - source_artifact:pmid-27002445
  workflow:
    kind: care_support
    ownerSkillIds:
      - chronic-pain-support
      - sleep-improvement
  startPrompt: Hey Murph, help me sleep better with chronic pain.
  indexable: true
safety:
  cautionLevel: moderate
---

Pain and sleep influence each other. Pain can make it hard to settle or stay in one position, while short or fragmented sleep can increase pain sensitivity and reduce coping the next day. The practical approach is to treat both sides: improve the pain plan and use evidence-based insomnia strategies without expecting a pillow or supplement to solve the whole cycle.

## What to do

- Identify the sleep problem caused by pain: difficulty finding a position, repeated awakenings, medication wearing off, fear of movement, or being exhausted but alert.
- Review the pain treatment plan with the relevant clinician. Timing of physical therapy, activity, and prescribed medicine may matter.
- Use supportive positioning that is comfortable for your condition. Change pillows or supports one at a time and stop if they create new numbness or pain.
- Keep a consistent wake time and avoid spending much of the day in bed. This protects sleep drive and helps bed remain a cue for sleep.
- Pace activity during the day. Doing almost nothing after a bad night and then overdoing it on a good day can create a boom-and-bust cycle.
- Use a calm reset when awake. Gentle repositioning, slow breathing, or a quiet activity outside bed can reduce the fight with sleep.

## A simple plan

For two weeks, record bedtime, pain at bedtime from 0 to 10, number of pain-related awakenings, and next-day function. Keep the record short enough that it does not increase symptom monitoring.

Choose one sleep change and one pain-management change. The sleep change might be a fixed wake time or leaving bed when frustration builds. The pain change might be a physical-therapy exercise, an activity-pacing plan, or a clinician-approved adjustment to timing—not dose—of existing treatment.

Prepare the bedside setup before you are tired: supports, water, and any prescribed tools. If pain wakes you, use the same brief sequence rather than searching for new techniques at 3 a.m. Review the pattern weekly with the clinician when medication or treatment decisions are involved.

## How to know it is working

Look beyond pain intensity. Useful progress includes fewer long awakenings, less time fighting for a comfortable position, better confidence about sleep, and improved function the next day. Pain may remain present while sleep becomes less disrupted.

Wearables cannot tell whether an awakening was caused by pain and may label still, uncomfortable wakefulness as sleep. Your diary and function are more important. Judge the plan over weeks, because both pain and sleep naturally vary.

## If you get stuck

More time in bed often feels like the obvious response but can reduce sleep drive and increase time awake with pain. If the plan is becoming more restrictive, ask for CBT-I adapted for chronic pain. Behavioral pain therapy can also address fear, pacing, and the attention that pain demands.

Review medicines that affect sleep. Opioids can worsen sleep-related breathing; some medicines cause sedation without restorative sleep; others may wear off overnight. Never change or combine them without the prescriber. Loud snoring, gasping, or severe daytime sleepiness deserves evaluation.

## A quick note

Seek urgent care for new weakness, loss of bladder or bowel control, chest pain, severe unexplained pain, or other new neurologic symptoms. Avoid combining alcohol with opioid, sleep, or anxiety medicines.

## Sources

- [NCCIH: chronic pain and complementary health approaches](https://www.nccih.nih.gov/health/chronic-pain-in-depth)
- [AASM guideline for behavioral treatment of chronic insomnia](https://jcsm.aasm.org/doi/10.5664/jcsm.8986)

