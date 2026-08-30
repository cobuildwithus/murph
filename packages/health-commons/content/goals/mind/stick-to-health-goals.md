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

People rarely fail health goals because they lack information. More often, the goal competes with work, caregiving, fatigue, money, symptoms, social life, and other goals. The answer is not a stricter motivational speech. It is a plan with a clear priority, visible feedback, and a smaller version for difficult weeks.

Begin with the outcome that matters now. “Get healthy” can produce ten simultaneous projects—sleep, diet, exercise, supplements, stress, alcohol, and screening—none of which receives enough attention. One primary outcome creates a plan you can actually test and maintain.

## What to do

- **Choose one lead goal.** You can care about many things while actively changing one or two. Pick the outcome with the best combination of importance, readiness, and feasibility.
- **Define the weekly behavior.** Translate the outcome into actions you control: three walks, protein at breakfast, taking medication as prescribed, or a consistent sleep window.
- **Set a minimum and a target.** The target is the full plan; the minimum is what happens during travel, illness, deadlines, or low energy. A minimum prevents all-or-nothing collapse.
- **Schedule the behavior in context.** Decide when, where, and what precedes it. A calendar entry without an operating plan is only a reminder.
- **Track lightly.** Use the smallest feedback that can guide a decision: sessions completed, days the behavior occurred, or a weekly metric. Do not collect data you will not use.
- **Review causes, not character.** When the plan fails, ask whether the action was too large, the cue unstable, the environment hostile, the goal unimportant, or recovery insufficient.
- **Use support deliberately.** Tell a friend, coach, clinician, or family member what would help—joining you, checking in, changing food at home, or protecting time.

## A simple plan

Write a one-page goal card:

- **Outcome:** what you want to improve and why it matters now.
- **Target behavior:** the action and weekly frequency.
- **Minimum behavior:** the version for a hard week.
- **Cue and place:** when and where it happens.
- **Likely obstacle:** the most predictable reason it will not happen.
- **Response:** what you will do when that obstacle appears.
- **Review date:** one week from now.

Run the plan for two weeks without adding another goal. At each weekly review, compare target, minimum, and actual behavior. If you reached the target, keep it stable before increasing. If you reached only the minimum, decide whether this was a temporary hard week or the target is unrealistic. If neither happened, redesign the cue, environment, or action size.

Use a restart rule: after a missed week, schedule the next minimum action within 48 hours. Do not compensate with an extreme workout, restrictive diet, or doubled dose. Consistency returns through the next normal action.

After four weeks, assess both behavior and outcome. The behavior should become more reliable before you expect a major biomarker or fitness change. If the outcome is unchanged despite good follow-through, the strategy may need adjustment; do not automatically demand more effort.

## How to know it is working

The strongest early signal is that the plan survives variation. You complete the target in ordinary weeks, use the minimum during hard ones, and restart quickly after disruption. The health outcome may lag behind this behavioral stability.

Look at four-week completion and trend data. A simple plan performed at 70 to 80 percent can outperform a perfect plan performed briefly. Avoid turning that percentage into another grade; use it to decide whether the system fits your life.

## If you get stuck

If every goal feels urgent, ask which one unlocks others. Better sleep may improve food and activity follow-through; treating pain may make walking possible. If symptoms or a chronic condition constrain the plan, coordinate with the clinician who knows the condition.

If tracking becomes obsessive, remove daily numbers and review weekly. If the goal repeatedly requires sacrificing sleep, relationships, or necessary care, it is not a sustainable health plan.

## A quick note

Some outcomes are not fully controllable. Your effort is not a guarantee of a lab value, weight, symptom, or performance result. Judge the plan by informed action and useful adaptation, not by blaming yourself for biology.

## Sources

- [Umbrella review of behavior-change techniques in lifestyle interventions](https://pmc.ncbi.nlm.nih.gov/articles/PMC11545567/)
- [Time to Form a Habit: systematic review and meta-analysis](https://doi.org/10.3390/healthcare12232488)
- [NICE: behavior change—individual approaches](https://www.nice.org.uk/guidance/ph49)
