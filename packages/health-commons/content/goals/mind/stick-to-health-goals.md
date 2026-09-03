---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:stick-to-health-goals
slug: stick-to-health-goals
title: Stick to My Health Goals
summary: Turn a broad health intention into a small set of actions that can survive busy weeks, setbacks, and changing motivation.
status: field-testing
quality: usable
aliases:
  - follow through on health goals
  - stay consistent with health goals
categories:
  - goals
  - mind
  - follow-through
goal:
  category: mind
  parentGoalKey: goal_template:build-a-habit
  outcomeKind: behavior
  goalPhrase: stick to my health goals
  successSignals:
    - id: priority_action
      kind: behavior
      label: The highest-value health action happens most weeks
    - id: minimum_plan
      kind: behavior
      label: A smaller fallback keeps the plan alive during disruption
    - id: weekly_adjustment
      kind: function
      label: The plan is reviewed and adjusted without abandoning the goal
  evidenceSourceKeys:
    - source_artifact:clinicaltrials-nct05217602-2026-04-27
    - source_artifact:pmid-28527330
  workflow:
    kind: general_plan
    ownerSkillIds:
      - behavior-followthrough
  startPrompt: Hey Murph, help me stick to my health goals.
  indexable: true
safety:
  cautionLevel: low
---

People rarely fail health goals for lack of information. The goal loses to work, caregiving, fatigue, money, symptoms, social life, and other goals. What helps is a plan with one clear priority, visible feedback, and a smaller version for hard weeks.

Start with the outcome that matters now. "Get healthy" spawns ten projects at once (sleep, diet, exercise, supplements, stress, alcohol, screening) and none gets enough attention. One primary outcome gives you a plan you can test.

## What to do

- **Choose one lead goal.** Pick the outcome with the best mix of importance, readiness, and feasibility.
- **Define the weekly behavior.** Turn the outcome into actions you control: three walks, protein at breakfast, taking medication as prescribed, or a consistent sleep window.
- **Set a minimum and a target.** The target is the full plan. The minimum is what happens during travel, illness, deadlines, or low energy, and it prevents all-or-nothing collapse.
- **Schedule the behavior in context.** Decide when, where, and what comes right before it.
- **Track lightly.** Use the smallest feedback that can guide a decision: sessions done, days the behavior happened, or one weekly metric.
- **Review causes, not character.** When the plan fails, ask whether the action was too big, the cue unstable, the environment hostile, the goal unimportant, or recovery too thin.
- **Use support deliberately.** Tell a friend, coach, clinician, or family member what would help: joining you, checking in, changing the food at home, or protecting time.

## A simple plan

Write a one-page goal card:

- **Outcome:** what you want to improve and why it matters now.
- **Target behavior:** the action and its weekly frequency.
- **Minimum behavior:** the version for a hard week.
- **Cue and place:** when and where it happens.
- **Likely obstacle:** the most predictable reason it will not happen.
- **Response:** what you will do when that obstacle shows up.
- **Review date:** one week from now.

Run the plan for two weeks without adding another goal. At each weekly review, compare target, minimum, and what actually happened. If you hit the target, hold it steady before increasing. If you only reached the minimum, decide whether it was a temporary hard week or the target is unrealistic. If neither happened, redesign the cue, the environment, or the size of the action.

Use a restart rule: after a missed week, schedule the next minimum action within 48 hours. Do not make up for it with an extreme workout, a restrictive diet, or a doubled dose.

After four weeks, look at both behavior and outcome. The behavior should get reliable before you expect a big change in a biomarker or fitness. If the outcome has not moved despite good follow-through, change the strategy rather than demanding more effort.

## How to know it is working

The strongest early signal is that the plan survives variation: you hit the target in ordinary weeks, use the minimum in hard ones, and restart quickly after a disruption. The health outcome may lag behind that.

Look at four-week completion and the trend. A simple plan done at 70 to 80 percent can beat a perfect plan done briefly.

## If you get stuck

If every goal feels urgent, ask which one makes the others easier. Better sleep may improve food and activity follow-through; treating pain may make walking possible. If symptoms or a chronic condition limit the plan, coordinate with the clinician who knows the condition.

If tracking turns obsessive, drop the daily numbers and review weekly. If the goal keeps costing you sleep, relationships, or necessary care, it is not a health plan you can keep.

## A quick note

Some outcomes are not fully in your control. Effort does not guarantee a lab value, a weight, a symptom, or a performance result. Judge the plan by informed action and useful adjustment, not by blaming yourself for biology.

## Sources

- [Umbrella review of behavior-change techniques in lifestyle interventions](https://pmc.ncbi.nlm.nih.gov/articles/PMC11545567/)
- [Time to Form a Habit: systematic review and meta-analysis](https://doi.org/10.3390/healthcare12232488)
- [NICE: behavior change—individual approaches](https://www.nice.org.uk/guidance/ph49)
