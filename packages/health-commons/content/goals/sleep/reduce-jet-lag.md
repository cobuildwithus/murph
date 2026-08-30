---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-jet-lag
slug: reduce-jet-lag
title: Reduce Jet Lag
summary: Align sleep, light, meals, and activity with a new time zone so travel disrupts fewer days.
status: field-testing
quality: usable
aliases:
  - get over jet lag faster
  - prevent jet lag
categories:
  - goals
  - sleep
  - travel
  - circadian-rhythm
goal:
  category: sleep
  outcomeKind: symptom
  goalPhrase: reduce jet lag
  successSignals:
    - id: destination_sleep
      kind: function
      label: Sleeping closer to destination nighttime
    - id: destination_alertness
      kind: function
      label: Better alertness during destination daytime
    - id: fewer_jet_lag_days
      kind: symptom
      label: Fewer days disrupted by jet lag
  evidenceSourceKeys:
    - source_artifact:pmid-32303523
    - source_artifact:pmid-34263388
  workflow:
    kind: general_plan
    ownerSkillIds:
      - circadian-rhythm
      - sleep-recovery-readiness
  startPrompt: Hey Murph, help me reduce jet lag.
  indexable: true
safety:
  cautionLevel: moderate
---

Jet lag happens when the local clock changes faster than your body clock can adapt. The highest-value tools are correctly timed light, sleep, meals, and activity. The plan depends on direction, time zones crossed, arrival time, trip length, and how quickly you need to perform. Eastward travel usually requires moving earlier and is often harder than moving later after westward travel.

## What to do

- Build the plan around **destination time**, not vague advice to seek or avoid light. Light at the wrong biological time can shift you in the wrong direction.
- For a major eastward trip, begin moving sleep and wake time earlier by about 30 to 60 minutes for two or three days when practical. For westward travel, move later.
- Protect sleep before departure. Starting the trip sleep deprived makes every part of jet lag feel worse.
- Change your watch and phone to destination time during the journey. Time sleep, meals, and caffeine around the destination day.
- After arrival, use daylight to support the shift and keep moving during local daytime. Avoid a long daytime sleep that makes the first local night impossible.
- Use a short nap when needed for safety or essential performance, then get back into the local day.
- Limit excess alcohol. It can fragment in-flight and destination sleep and worsen dehydration-related discomfort.

## A simple plan

Three days before travel, write down the origin schedule, destination schedule, flight times, and first important commitment. Shift bedtime and wake time toward the destination by 30 minutes per day if the trip is large enough to justify it.

On the flight, sleep only when it overlaps with destination nighttime. Use an eye mask, earplugs, and a neck support if they make rest easier. Hydrate normally, eat lightly according to comfort, and use caffeine only during destination daytime.

On arrival, stay awake through the local day when safely possible. Get appropriate daylight, eat on local time, and use a brief nap rather than a multi-hour sleep. Keep the first two evenings simple and allow a generous sleep opportunity.

For a trip of only one or two nights, full adaptation may not be worthwhile. Maintaining more of your home schedule can be the better tradeoff, especially when the event time allows it.

## How to know it is working

Track sleep timing, daytime sleepiness, and whether you can function during the hours that matter. Gastrointestinal symptoms and mood can lag behind sleep. Do not judge the plan solely by the first night, which may also be affected by the flight and an unfamiliar room.

Adaptation commonly takes multiple days. A rough rule is that eastward adjustment tends to be slower than westward adjustment, but individual variation is large. The useful question is whether each day is moving closer to local sleep and wake times.

## If you get stuck

Check the direction and timing of light first. Random bright-light exposure or taking melatonin at bedtime without regard to direction can be ineffective or counterproductive. Also look for long naps, late caffeine, early-morning light after westward travel, and late-evening light after eastward travel.

If travel is frequent, save a reusable plan for common routes rather than starting from scratch. A travel-medicine or sleep clinician can help with complex itineraries, medications, or precisely timed melatonin.

## A quick note

Melatonin can interact with medicines and product quality varies. Get professional guidance for pregnancy, bipolar disorder, seizure disorders, anticoagulants, or other significant medical considerations. Never drive when jet lag has left you dangerously sleepy.

## Sources

- [CDC Yellow Book 2026: jet lag disorder](https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html)
- [Consensus statement on managing travel fatigue and jet lag](https://pubmed.ncbi.nlm.nih.gov/34263388/)
