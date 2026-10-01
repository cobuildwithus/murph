---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:run-first-5k
slug: run-first-5k
title: Run My First 5K
summary: Progress from short run-walk sessions to completing 5 kilometers with controlled effort and a plan you can repeat.
status: field-testing
quality: usable
aliases:
  - run a first 5K
  - train for my first 5K
  - couch to 5K
categories:
  - goals
  - cardio
  - running
  - 5k
goal:
  category: cardio
  outcomeKind: event
  goalPhrase: run my first 5K
  successSignals:
    - id: weekly_run_walk_sessions
      kind: behavior
      label: Three repeatable run-walk sessions each week
    - id: longest_continuous_run
      kind: capacity
      label: A growing comfortable continuous run
    - id: five_kilometer_finish
      kind: milestone
      label: Five kilometers completed in control
  evidenceSourceKeys:
    - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
    - source_artifact:pmid-18580415
  workflow:
    kind: training_plan
    ownerSkillIds:
      - competition-training
      - running-cardio
  startPrompt: Hey Murph, help me run my first 5K.
  indexable: true
safety:
  cautionLevel: moderate
---

Your first 5K is an endurance project: keep moving for roughly 30 to 50 minutes, run more of that time as weeks pass, and learn a pace you can hold. Walking, in training or on the day, is fully compatible with finishing.

Most healthy beginners need at least six to ten weeks. The right timeline depends on your current walking and running, not a calendar.

## What to do

- Run or run-walk three times a week on nonconsecutive days.
- Keep most running conversational; if you can't control the first few minutes, slow down.
- Build total time before speed. One longer easy outing beats repeated short races.
- Take planned walk breaks as long as they keep form and breathing steady.
- Add one or two short strength sessions for calves, hips, and legs.
- With an event date, make the final week lighter instead of chasing last-minute fitness.

## A simple plan

Start with three sessions of 25 to 35 minutes. In week one, alternate two minutes of easy running with two of walking. If that's too much, run one minute at a time; if it's already easy, start at three to four minutes.

Each week, lengthen one or two running intervals and keep the session about the same length. Once you can run ten minutes at a stretch, add five minutes to one outing a week. The other two stay short and easy.

Mid-plan, a week might hold a 25-minute easy run-walk, a 30-minute session with several five-minute runs, and a 40-minute easy outing. Later, work toward 20 to 30 continuous minutes. You don't need a continuous 5K in training; four to five kilometers of mixed easy running and walking shows the distance is within reach.

In the final week, cut volume, keep two short easy runs, and rest or walk the day before. Start the 5K slower than excitement suggests, and build the effort after halfway if you still feel strong.

## How to know it is working

Look for more running in the same session, a longer comfortable outing, and quicker recovery after hills. Easy pace may improve but doesn't have to. The main marker is that 5K-sized time on your feet feels normal.

For an organized event, success is starting healthy enough to take part and finishing willing to run again. Time can be a later goal.

## If you get stuck

If you can't extend the running intervals, slow them down or lengthen the walk breaks. If your legs are sore after every run, hold volume for a week, swap one run for cycling or walking, and check whether hard surfaces and hills crept in together.

If consistency is the problem, fix three days and make the minimum session ten minutes. After a missed week, repeat the last good week instead of skipping ahead.

## A quick note

Don't train through pain that changes your stride, swelling, or worsening focal bone pain. Stop for chest pain, fainting, or severe unusual breathlessness.

## Sources

- [Physical Activity Guidelines for Americans, 2nd edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [World Athletics: 5000 metres training context](https://worldathletics.org/disciplines/middlelong/5000-metres)
- [NHS Couch to 5K running plan](https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/)
