---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:get-150-minutes-of-cardio
slug: get-150-minutes-of-cardio
title: Get 150 Minutes of Cardio Each Week
summary: Turn the public-health activity target into a flexible weekly pattern that fits your schedule and starting point.
status: field-testing
quality: usable
aliases:
  - reach 150 minutes of exercise a week
  - meet the weekly cardio guideline
categories:
  - goals
  - cardio
  - weekly-activity
goal:
  category: cardio
  outcomeKind: behavior
  goalPhrase: get 150 minutes of cardio each week
  successSignals:
    - id: weekly_cardio_minutes
      kind: behavior
      label: Weekly moderate-equivalent aerobic minutes
    - id: active_days
      kind: behavior
      label: Aerobic activity spread across the week
    - id: sustainable_weekly_pattern
      kind: function
      label: A weekly pattern that survives ordinary disruptions
  evidenceSourceKeys:
    - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
    - source_artifact:who-physical-activity-guidelines-2020-11-25
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - running-cardio
      - daily-activity
      - behavior-followthrough
  startPrompt: Hey Murph, help me get 150 minutes of cardio each week.
  indexable: true
safety:
  cautionLevel: low
---

Adults can obtain substantial health benefits by accumulating 150 to 300 minutes of moderate-intensity aerobic activity per week, or 75 to 150 minutes of vigorous activity, or an equivalent combination. The target is a weekly total, not a requirement to exercise for exactly 30 minutes on five perfect days.

If you are below 150 minutes now, some activity is still better than none. Build toward the target from your real baseline rather than treating the guideline as an all-or-nothing threshold.

## What to do

- Count activities that meaningfully raise breathing: brisk walking, cycling, swimming, dancing, jogging, rowing, active sports, and similar work.
- Use the talk test. Moderate effort usually allows conversation but not singing; vigorous effort permits only a few words at a time.
- Spread activity in whatever pattern fits. Ten-, 20-, and 40-minute bouts can all contribute.
- Put the most dependable sessions in the calendar first, then use optional movement to close the gap.
- Keep a minimum week for travel, deadlines, or low energy. A smaller maintained pattern is easier to rebuild from than zero.
- Add muscle-strengthening work on two days when possible; it is a separate part of public-health guidance, not part of the 150 aerobic minutes.

## A simple plan

First estimate your current weekly moderate-equivalent minutes. If you average less than 60, aim for 75 next week. If you average 60 to 100, add 15 to 25 minutes. If you already reach 120, distribute another 30 minutes where it fits most easily.

A straightforward 150-minute week could be:

- Monday: 25-minute brisk walk.
- Wednesday: 35-minute bike ride.
- Friday: 30-minute swim or cardio session.
- Saturday: 45-minute hike, run, or active sport.
- Sunday: 15-minute easy walk.

Another person might prefer three 50-minute sessions or several short bouts. For counting a mixed week, one minute of vigorous activity is commonly treated as roughly two minutes of moderate activity in the guideline total. That is a planning shorthand, not a precise calorie or fitness conversion.

Increase over several weeks if needed. Hold or reduce the total when soreness, fatigue, or life load rises. The aim is a repeatable month, not one exceptional week.

## How to know it is working

Add minutes once per week rather than constantly checking. Use actual workout duration when available, and estimate brisk walking or active-sport time honestly. Over four weeks, look for how often you reach the target and whether the pattern feels easier to maintain.

The 150-minute number is a useful floor for broad health guidance, not a personalized maximum. Your sport, event, or medical plan may call for a different amount. Conversely, a week below 150 still has value.

## If you get stuck

If time is the barrier, divide sessions into 10- to 20-minute blocks and use walking for transport or calls. If fatigue is the barrier, replace one hard session with comfortable activity. If the total depends on one long weekend session, build a small weekday anchor so one cancellation does not erase the week.

If 150 minutes is currently unrealistic, choose the next reachable floor and hold it for several weeks. Adherence usually improves when the plan names exactly when and where the first few sessions happen.

## A quick note

Increase gradually if you are currently inactive. Stop for chest pain, fainting, or severe unusual breathlessness, and adapt the target with clinical guidance when a health condition materially limits exercise.

## Sources

- [Physical Activity Guidelines for Americans, 2nd edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [WHO guidelines on physical activity and sedentary behaviour](https://www.who.int/publications/i/item/9789240015128)
- [ODPHP: Top 10 things to know about the current U.S. guidelines](https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines/top-10-things-know)

