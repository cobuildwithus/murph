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

Food cravings are strong, specific urges driven by hunger, learned cues, stress, sleep loss, restriction, reward, or plain availability. Trying to stamp out every craving usually makes food loom larger. A better aim is to cut preventable triggers and leave enough room to choose what happens next, which sometimes means eating the food on purpose.

## What to do

First, tell a craving from plain hunger. If many foods sound good, you probably need a meal. If one specific food feels compelling, a cue or emotion is likely involved.

Cut the common drivers:

- Eat regular meals with enough protein, fiber-rich carbohydrate, and total energy.
- Don't follow long stretches of restriction with a kitchen full of easy snack food.
- Protect sleep. Short or irregular sleep makes appetite harder to regulate.
- Move your most automatic trigger food out of sight, or buy it in a size that makes a deliberate portion easy.
- Pair predictable cue moments (getting home, watching television, finishing work) with a different first action.
- Allow food you enjoy. Rigid “never” rules can fuel preoccupation and rebound eating.

When a craving hits, pause for ten minutes, name the likely driver, and choose: eat a meal, have a planned portion, delay and do something else, or remove the cue.

## A simple plan

For seven days, record only strong cravings: time, hunger level, situation, sleep, and what happened next. Look for one repeating pattern, then pick one intervention for two weeks.

If cravings hit at 4 p.m. after a light lunch, make lunch bigger or add a planned snack. If they hit while you watch television, portion the food first and put the package away. If they follow a stressful workday, eat a real dinner before deciding on dessert and add a non-food transition such as a walk or shower.

Rate the urge from 0 to 10 when it starts and again 15 minutes later. You're not chasing a zero; you're learning that urges change and that you can choose the response.

## How to know it is working

Track strong-craving episodes per week, average intensity, and the share that ended in a response you felt good about. Watch whether regular eating, sleep, and stress improved too. Don't make shame or “days without sugar” the main metric.

## What to expect

Hunger-driven cravings can ease within days once meals are big enough. Cue-driven cravings take repeated practice with a new routine. Stress and the menstrual cycle can still bring harder weeks. Less urgency and less loss of control is real progress even if the food still appeals.

## If you get stuck

If cravings get stronger, check whether the plan has become another restrictive diet. If one food always leads to overeating, try a planned single portion after a meal instead of keeping a large package nearby. If medication, cannabis, alcohol, or sleep deprivation is changing your appetite, deal with that. Repeated episodes of eating unusually large amounts with loss of control deserve professional assessment.

## A quick note

Recurrent binge eating, compensatory exercise, vomiting, laxative use, fasting after eating, or severe distress around food are not willpower problems. Evidence-based eating-disorder care can help. If you take diabetes medicines, learn to tell an ordinary craving from low blood sugar and follow your treatment plan.

## Sources

- [NIDDK: Binge eating disorder](https://www.niddk.nih.gov/health-information/weight-management/binge-eating-disorder/definition-facts)
- [Review: Protein, weight management, and satiety](https://pubmed.ncbi.nlm.nih.gov/18469287/)
- [CDC: How much sleep adults need](https://www.cdc.gov/sleep/about/index.html)

## Related goals

[Feel Fuller Between Meals](/goals/feel-fuller-between-meals) · [Eat Regular Meals](/goals/eat-regular-meals) · [Reduce Emotional Eating](/goals/reduce-emotional-eating)
