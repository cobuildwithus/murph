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

Your first 5K is best approached as an endurance project, not a speed test. Build the ability to spend roughly 30 to 50 minutes moving forward, gradually increase the running inside that time, and learn a pace you can sustain. Walking during training—or during the event—is completely compatible with finishing a 5K.

Most healthy beginners benefit from at least six to ten weeks, but the correct timeline depends on current walking and running capacity rather than a fixed calendar.

## What to do

- Run or run-walk three times per week on nonconsecutive days.
- Keep most running conversational. If you cannot control the first few minutes, slow down.
- Build total time before speed. A longer easy outing prepares you better than repeated short races.
- Use planned walk breaks while they keep form and breathing steady.
- Add one or two short strength sessions for calves, hips, and legs.
- If you have an event date, leave the final week lighter instead of trying to gain fitness at the last moment.

## A simple plan

Begin with three 25- to 35-minute sessions. In week one, alternate two minutes easy running with two minutes walking. If that is too much, use one-minute runs; if it is already easy, begin with three to four minutes running.

Each week, lengthen one or two running intervals while keeping the session duration similar. When you can run for ten minutes at a time, make one weekly outing longer by five minutes. The other two stay shorter and easy.

By the middle of the plan, a week might include a 25-minute easy run-walk, a 30-minute session with several five-minute runs, and a 40-minute easy outing. Later, work toward 20 to 30 continuous minutes, but do not require a continuous 5K in training. Completing four to five kilometers through a mix of easy running and walking is enough evidence that the distance is within reach.

In the final week, reduce the volume, keep two short easy runs, and rest or walk the day before. Start the 5K slower than the pace your excitement suggests. If you feel strong after halfway, gradually increase the effort.

## How to know it is working

Look for more running within the same session, a longer comfortable outing, and quicker recovery after hills. Your easy pace may improve, but it does not need to. The primary marker is that 5K-sized time on your feet becomes normal.

If the goal is an organized event, success is reaching the start healthy enough to participate and completing the course in a way that makes you willing to run again. Time can become a later goal.

## If you get stuck

If you cannot extend the running intervals, slow them down or keep the walk breaks longer. If the legs are sore after every run, hold the volume for a week, replace one run with cycling or walking, and check that hard surfaces and hills have not increased at the same time.

If consistency is the problem, fix three specific days and make the minimum session ten minutes. If you miss a week, repeat the last successful week rather than skipping ahead to match a template.

## A quick note

Pain that changes your stride, swelling, or worsening focal bone pain should not be trained through. Stop for chest pain, fainting, or severe unusual breathlessness.

## Sources

- [Physical Activity Guidelines for Americans, 2nd edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [World Athletics: 5000 metres training context](https://worldathletics.org/disciplines/middlelong/5000-metres)
- [NHS Couch to 5K running plan](https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/)
