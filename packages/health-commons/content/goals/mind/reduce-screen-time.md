---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-screen-time
slug: reduce-screen-time
title: Reduce My Screen Time
summary: Replace low-value, automatic screen use with more intentional technology use and activities you want back.
status: field-testing
quality: usable
aliases:
  - spend less time on my phone
  - use screens less
categories:
  - goals
  - mind
  - digital-wellbeing
goal:
  category: mind
  outcomeKind: behavior
  goalPhrase: reduce my screen time
  successSignals:
    - id: low_value_minutes
      kind: behavior
      label: Less time goes to low-value or automatic screen use
    - id: protected_periods
      kind: behavior
      label: Chosen phone-free periods happen consistently
    - id: reclaimed_activity
      kind: function
      label: Reclaimed time goes to sleep, movement, focus, or connection
  evidenceSourceKeys:
    - source_artifact:doi-10-1016-j-abrep-2021-100365
    - source_artifact:pmid-32040492
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - cognitive-focus
      - behavior-followthrough
  startPrompt: Hey Murph, help me reduce my screen time.
  indexable: true
safety:
  cautionLevel: low
---

Screen time is not one behavior. Work, navigation, video calls, reading, gaming, and automatic scrolling all land in the same total. Aim for less low-value use and more say over when screens enter sleep, focus, movement, and relationships, not the smallest possible number.

Recent randomized trials suggest large smartphone reductions can improve wellbeing, stress, sleep, or sustained attention in some groups, but the interventions were short and often hard to keep up. They show behavior can change, not that everyone needs the same daily limit.

## What to do

- **Separate required, valued, and automatic use.** Keep what serves work or relationships. Target the apps, times, and contexts that feel least intentional.
- **Choose one protected period.** Meals, the first 30 minutes after waking, focus blocks, or the bedroom are easier targets than "use my phone less all day."
- **Move the device.** Charge it outside the bedroom, put it in a bag, or leave it in another room during the protected period.
- **Remove invitations.** Turn off nonessential notifications, remove badges, log out, or move high-use apps off the home screen.
- **Add a replacement.** Put a book, walking shoes, a notebook, or music where the screen used to be.
- **Use tools as boundaries, not combat.** If you override app limits and blockers daily, change the environment or the goal instead of stacking stricter alerts.
- **Keep useful connection.** If passive use was standing in for connection, switch to direct calls, planned messages, or time in person.

## A simple plan

Look at one ordinary week of device data and find the top one or two low-value uses. Pick a reduction that is meaningful but believable: 30 fewer minutes of short-form video, say, or no phone during dinner and the last 30 minutes before bed.

For two weeks:

1. Define the protected time and where the phone goes.
2. Disable the notifications most likely to break the boundary.
3. Prepare one replacement activity.
4. Record whether the boundary held and what you did instead.

After week one, sort the failures by cause: forgot, needed the device, boredom, social expectation, habit, or emotional escape. If you genuinely needed the phone, keep the function and block the distraction. If boredom dominates, improve the replacement. If stress dominates, add a direct stress plan.

After two weeks, check the targeted use and the outcome you wanted back: sleep timing, focus, movement, or connection. Keep the boundary if life improved. A smaller reduction that lasts beats a dramatic detox followed by rebound.

## How to know it is working

Success is more deliberate use and a visible benefit somewhere else: picking up the phone less automatically, protecting conversations, starting tasks sooner, sleeping on time, or spending more time moving or outdoors.

Device totals are rough and include valuable use. Look at the target app or period and what replaced it. If the number drops but the same behavior moves to another device, nothing has changed.

## If you get stuck

If work requires constant access, set role-specific windows and escalation channels rather than a blanket ban. If family or accessibility needs run through the phone, keep those functions. If every restriction produces a strong rebound, start with one location or one 15-minute period.

Compulsive digital use can be tied to anxiety, loneliness, depression, ADHD, insomnia, or avoidance. When use causes major impairment and stays hard to control, professional support beats ever more punitive blockers.

## A quick note

Do not cut access to emergency contacts, medical devices, navigation, or needed accessibility tools. The target is low-value automatic use, not technology that keeps you connected, safe, or independent.

## Sources

- [BMC Medicine: smartphone screen-time reduction randomized trial](https://doi.org/10.1186/s12916-025-03944-z)
- [PNAS Nexus: blocking mobile internet and sustained attention](https://doi.org/10.1093/pnasnexus/pgaf017)
- [PLOS ONE: randomized restriction of digital and social media](https://doi.org/10.1371/journal.pone.0306910)
