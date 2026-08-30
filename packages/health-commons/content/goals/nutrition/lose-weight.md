---
schemaVersion: murph.commons.page.v1
entityType: goal_template
key: goal_template:lose-weight
slug: lose-weight
title: Lose Weight
summary: "Create a modest energy deficit with food and activity changes you can actually keep, while protecting strength, nutrition, and ordinary life."
status: field-testing
quality: usable
aliases:
  - sustainable weight loss
  - lose body weight
  - lose weight and keep it off
goal:
  category: nutrition
  outcomeKind: biomarker
  goalPhrase: lose weight
  successSignals:
    - id: weight-trend
      kind: biomarker
      label: Gradual downward weight trend
    - id: waist-trend
      kind: biomarker
      label: Waist trend when useful
    - id: repeatable-food-pattern
      kind: behavior
      label: Follow a repeatable eating pattern
    - id: strength-preserved
      kind: capacity
      label: Preserve strength and daily function
  evidenceSourceKeys:
    - source_artifact:usda-hhs-dietary-guidelines-2026-01-07
    - source_artifact:pmid-19400750
    - source_artifact:pmid-25926512
    - source_artifact:pmid-18195317
  workflow:
    kind: general_plan
    ownerSkillIds:
      - body-composition
      - nutrition-strategy
  startPrompt: "Hey Murph, help me lose weight."
  indexable: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - "Pregnancy, breastfeeding with nutrition or infant-growth concerns, adolescence, underweight, an eating disorder, or recent major illness or surgery"
    - "Unintentional or unexplained weight loss, diabetes medication with low-glucose risk, or prescription weight-loss treatment"
  stopIf:
    - "Rapid loss, fainting, persistent dizziness, major weakness, menstrual disruption, bingeing, purging, or escalating food and body preoccupation occurs"
  notes:
    - "Weight is one possible outcome, not a moral score or the only measure of health."
---

Weight loss occurs when energy intake stays below energy use over time, but the best plan is rarely the most aggressive deficit. It is the smallest set of food and activity changes that produces a gradual trend while preserving strength, nutrition, energy, and ordinary life. There is no single required diet, and body weight is not a moral score. This goal only makes sense when intentional weight loss is appropriate for you.

## What to do

Define what you want weight loss to improve: mobility, blood pressure, comfort, athletic performance, a clinician-supported health target, or something else. That reason should shape how fast you move and what you refuse to sacrifice.

Build meals that are filling without demanding constant calculation. A useful default is a protein source, a fruit or vegetable, a satisfying high-fiber carbohydrate when desired, and enough fat for taste. Then identify one high-impact source of calories you barely value—such as sugary drinks, frequent alcohol, distracted grazing, or restaurant portions—and change that before banning foods you love.

Keep moving. Build toward at least 150 minutes of moderate activity per week and strength train twice weekly. Activity improves health, fitness, and weight maintenance even when the scale response is modest. For weight loss, food changes often create most of the energy deficit; movement helps preserve capacity and makes the result easier to maintain.

## A simple plan

Try an eight-week block:

1. **Week 1: measure a calm baseline.** Weigh under similar conditions on three to seven mornings, or once weekly if frequent weighing feels unhelpful. Record the average. Note waist circumference only if it adds useful context and is not distressing.
2. **Week 2: make meals visible.** Photograph or briefly record three ordinary days without trying to be perfect. Look for liquid calories, low-protein meals, large portions of energy-dense foods, and long gaps that lead to rebound eating.
3. **Weeks 3–4: change one food lever.** Examples: replace a daily sugary drink, halve the automatic restaurant side, serve a smaller first portion, or add a protein-and-produce breakfast. Keep pleasurable foods in planned amounts.
4. **Weeks 3–8: set a movement floor.** Choose a minimum you can maintain on a difficult week, such as a daily 20-minute walk, three cardio sessions, and two brief strength sessions. Add gradually from your current level.
5. **Week 5: solve the hardest context.** Plan the meal before a long shift, the restaurant order, the weekend breakfast, or the snack that prevents arriving home ravenous.
6. **Week 8: review the trend.** Keep changes that survived busy days and social meals. Remove rules that created guilt without affecting the trend.

Calorie tracking is optional. If you use it, treat the number as an estimate and a short learning tool. Portion changes, repeatable meals, and regular weighing can work without logging every ingredient. The plan should also include maintenance from day one: use behaviors you would be willing to continue after weight stabilizes.

## How to know it is working

Use a 7-day weight average or compare the same day each week. Daily shifts mostly reflect water, sodium, carbohydrate storage, food in the digestive tract, hormones, and training—not instant fat gain or loss. Look for a trend across at least three to four weeks.

For many people, roughly 0.5% of body weight per week is a reasonable middle ground, but slower can be appropriate. Larger early drops are often water. Track strength, energy, hunger, sleep, mood, and whether the plan survives weekends. A downward scale trend with collapsing performance, constant preoccupation, or binge eating is not a good trade.

Plateaus are normal because a smaller body uses less energy and because hunger, spontaneous movement, and adherence shift over time. A maintenance period is not failure. It can stabilize routines, improve training, and show whether the result is livable.

## If you get stuck

Do not call two noisy weeks a plateau. Wait for at least three reasonably consistent weeks, then examine the pattern without blame. Common explanations include larger weekend portions, liquid calories, declining daily movement, a plan that causes rebound hunger, or measurement conditions that changed.

Adjust one lever modestly. Examples include a smaller restaurant portion, a planned afternoon snack, an extra walk, or replacing a drink. Reassess for another two to three weeks instead of making daily corrections.

If strength, mood, sleep, libido, or menstrual function is deteriorating, the deficit may be too large. Hold or increase intake rather than pushing harder. If hunger is extreme despite a modest plan, or weight does not respond over a longer period, review medications, sleep, health conditions, and treatment options with a qualified clinician. Prescription weight-loss medicines and bariatric procedures can be effective for some people, but they need individual assessment, monitoring, and a plan for nutrition and lean-mass preservation.

## A quick note

Do not pursue intentional weight loss during pregnancy, with untreated eating-disorder symptoms, or when weight is falling without trying. Get individualized care for diabetes medications, prescription weight-loss drugs, bariatric surgery, major organ disease, adolescence, underweight, or persistent symptoms. Fainting, chest pain, severe weakness, repeated vomiting, purging, or rapid unexplained loss needs prompt care.

## Sources

- [NIDDK: Eating and physical activity to lose or maintain weight](https://www.niddk.nih.gov/health-information/weight-management/adult-overweight-obesity/eating-physical-activity)
- [Dietary Guidelines for Americans, 2025–2030](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines)
- [Physical Activity Guidelines for Americans, second edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [Review of dietary protein in weight loss and maintenance](https://pubmed.ncbi.nlm.nih.gov/19400750/)
