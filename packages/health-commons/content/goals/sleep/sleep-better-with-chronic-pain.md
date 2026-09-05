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

Pain and sleep feed each other. Pain can make it hard to settle or hold a position, and short, broken sleep can raise pain sensitivity and wear down coping the next day. Treat both sides with a better pain plan and evidence-based insomnia strategies; no pillow or supplement will fix the whole cycle.

## What to do

- Name the sleep problem the pain causes: trouble finding a position, repeated awakenings, medication wearing off, fear of movement, or being exhausted but alert.
- Review the pain treatment plan with the relevant clinician. Timing of physical therapy, activity, and prescribed medicine may matter.
- Use supportive positioning for your condition, changing pillows or supports one at a time and stopping if they cause new numbness or pain.
- Keep a consistent wake time and stay out of bed most of the day to protect sleep drive and keep bed a cue for sleep.
- Pace daytime activity. Almost nothing after a bad night and too much on a good day can create a boom-and-bust cycle.
- Use a calm reset when you're awake: gentle repositioning, slow breathing, or a quiet activity out of bed can reduce the fight with sleep.

## A simple plan

For two weeks, record bedtime, pain at bedtime from 0 to 10, pain-related awakenings, and next-day function. Keep it short so it doesn't become more symptom monitoring.

Choose one sleep change, such as a fixed wake time or leaving bed when frustration builds, and one pain change, such as a physical-therapy exercise, an activity-pacing plan, or a clinician-approved change to the timing (not the dose) of existing treatment.

Set up the bedside before you're tired: supports, water, and any prescribed tools. If pain wakes you, run the same brief sequence rather than hunting for new techniques at 3 a.m. Review the pattern weekly with your clinician when medication or treatment decisions are involved.

## How to know it is working

Look past pain intensity. Progress means fewer long awakenings, less time fighting for a comfortable position, more confidence about sleep, and better next-day function, even if pain itself remains.

Wearables can't tell whether pain caused an awakening and may count still, uncomfortable wakefulness as sleep; your diary and function matter more. Judge the plan over weeks, since both pain and sleep naturally vary.

## If you get stuck

More time in bed feels like the obvious answer, but it can reduce sleep drive and add time awake in pain. If the plan is getting more restrictive, ask for CBT-I adapted for chronic pain. Behavioral pain therapy can also address fear, pacing, and the attention pain demands.

Review medicines that affect sleep. Opioids can worsen sleep-related breathing, some medicines sedate without restorative sleep, and others may wear off overnight. Never change or combine them without the prescriber. Loud snoring, gasping, or severe daytime sleepiness deserves evaluation.

## A quick note

Seek urgent care for new weakness, loss of bladder or bowel control, chest pain, severe unexplained pain, or other new neurologic symptoms. Don't combine alcohol with opioid, sleep, or anxiety medicines.

## Sources

- [NCCIH: chronic pain and complementary health approaches](https://www.nccih.nih.gov/health/chronic-pain-in-depth)
- [AASM guideline for behavioral treatment of chronic insomnia](https://jcsm.aasm.org/doi/10.5664/jcsm.8986)
