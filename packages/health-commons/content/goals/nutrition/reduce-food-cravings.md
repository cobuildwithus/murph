---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:reduce-food-cravings
slug: reduce-food-cravings
title: Reduce Food Cravings
summary: Make cravings less frequent and less disruptive by addressing hunger, cues, sleep, stress, and food availability.
status: field-testing
quality: usable
aliases:
  - control food cravings
goal:
  category: nutrition
  parentGoalKey: goal_template:eat-balanced-diet
  outcomeKind: symptom
  goalPhrase: reduce food cravings
  successSignals:
    - id: craving-frequency
      kind: symptom
      label: Strong cravings occur less often or feel less urgent
    - id: planned-response
      kind: behavior
      label: A workable response replaces automatic eating in common trigger situations
    - id: regular-nourishment
      kind: behavior
      label: Regular meals reduce cravings driven by under-eating
  evidenceSourceKeys:
    - source_artifact:pmid-20847729
    - source_artifact:pmid-18469287
  workflow:
    kind: habit_plan
    ownerSkillIds:
      - nutrition-strategy
      - behavior-followthrough
  startPrompt: Hey Murph, help me reduce food cravings.
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - Seek eating-disorder support when cravings occur with recurrent binges, purging, or severe restriction.
  notes:
    - Cravings are normal; the goal is less disruption, not never wanting a food.
---

Food cravings are strong, specific urges that can be driven by hunger, learned cues, stress, sleep loss, restriction, reward, or simple availability. Trying to eliminate every craving often makes food more salient. A better goal is to reduce preventable triggers and create enough space to choose what to do next—including sometimes eating the desired food intentionally.

## What to do

First distinguish a craving from general hunger. If many foods sound good, you may need a meal. If only one specific food feels compelling, a cue or emotion may be involved.

Reduce common drivers:

- Eat regular meals with enough protein, fiber-rich carbohydrate, and total energy.
- Avoid long periods of restriction followed by an environment full of easy snack food.
- Protect sleep; short or irregular sleep can make appetite regulation harder.
- Move the most automatic trigger food out of immediate sight or buy it in a size that supports intentional portions.
- Pair predictable cue moments—arriving home, watching television, finishing work—with a different first action.
- Allow enjoyable food. Rigid “never” rules can intensify preoccupation and rebound eating.

When a craving arrives, pause for ten minutes, name the likely driver, and choose: eat a meal, have a planned portion, delay and do something else, or remove the cue.

## A simple plan

For seven days, record only strong cravings: time, hunger level, situation, sleep, and what happened next. Look for one repeating pattern. Then choose one two-week intervention.

If cravings happen at 4 p.m. after a light lunch, strengthen lunch or add a planned snack. If they happen while watching television, pre-portion the food and put the package away. If they follow a stressful workday, eat a real dinner before deciding on dessert and add a non-food transition such as a walk or shower.

Rate urge intensity from 0 to 10 at the start and 15 minutes later. The goal is not a zero; it is learning that urges change and that the response can be chosen.

## How to know it is working

Track strong-craving episodes per week, average intensity, and the share that led to a response you felt good about. Also watch whether regular eating, sleep, and stress improved. Do not use shame or “days without sugar” as the primary metric.

## What to expect

Hunger-driven cravings can improve within days when meals become adequate. Cue-driven cravings take repeated exposure to a new routine. Stress and menstrual-cycle changes may still produce harder weeks. A reduction in urgency and loss of control is meaningful even if the desired food remains appealing.

## If you get stuck

If cravings intensify, check whether the plan became another restrictive diet. If a specific food always leads to overeating, experiment with a planned single portion after a meal rather than keeping a large package nearby. If medication, cannabis, alcohol, or sleep deprivation changes appetite, address that context. Persistent episodes of eating unusually large amounts with loss of control deserve professional assessment.

## A quick note

Recurrent binge eating, compensatory exercise, vomiting, laxative use, fasting after eating, or severe distress around food are not willpower problems. Evidence-based eating-disorder care can help. People taking diabetes medicines should distinguish an ordinary craving from symptoms of low blood sugar and follow their treatment plan.

## Sources

- [NIDDK: Binge eating disorder](https://www.niddk.nih.gov/health-information/weight-management/binge-eating-disorder/definition-facts)
- [Review: Protein, weight management, and satiety](https://pubmed.ncbi.nlm.nih.gov/18469287/)
- [CDC: How much sleep adults need](https://www.cdc.gov/sleep/about/index.html)

## Related goals

[Feel Fuller Between Meals](/goals/feel-fuller-between-meals) · [Eat Regular Meals](/goals/eat-regular-meals) · [Reduce Emotional Eating](/goals/reduce-emotional-eating)
