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

Weight comes off when you take in less energy than you use over time, but the most aggressive deficit is rarely the best plan. The best plan is the smallest set of food and activity changes that produces a gradual trend while keeping strength, nutrition, energy, and ordinary life intact. No single diet is required, and weight is not a moral score. This goal only makes sense when intentional weight loss is appropriate for you.

## What to do

Decide what you want weight loss to improve: mobility, blood pressure, comfort, athletic performance, a clinician-supported health target, or something else. That reason sets your pace and what you won't give up.

Build meals that fill you up without constant calculation: a protein source, a fruit or vegetable, a satisfying high-fiber carbohydrate if you want one, and enough fat for taste. Then find one big source of calories you barely value, such as sugary drinks, frequent alcohol, distracted grazing, or restaurant portions, and change that before banning foods you love.

Keep moving. Work toward at least 150 minutes of moderate activity a week plus strength training twice a week. Activity improves health, fitness, and weight maintenance even when the scale barely moves. Food usually creates most of the deficit; movement preserves capacity and makes the result easier to keep.

## A simple plan

Try an eight-week block:

1. **Week 1: measure a calm baseline.** Weigh under similar conditions on three to seven mornings, or once weekly if frequent weighing feels unhelpful, and record the average. Note waist only if it adds useful context and doesn't upset you.
2. **Week 2: make meals visible.** Photograph or jot down three ordinary days without trying to be perfect. Look for liquid calories, low-protein meals, big portions of energy-dense foods, and long gaps that lead to rebound eating.
3. **Weeks 3–4: change one food lever.** Replace a daily sugary drink, halve the automatic restaurant side, serve a smaller first portion, or add a protein-and-produce breakfast. Keep foods you enjoy in planned amounts.
4. **Weeks 3–8: set a movement floor.** Pick a minimum you can hold on a bad week, such as a daily 20-minute walk, three cardio sessions, and two short strength sessions. Build up gradually from your current level.
5. **Week 5: solve the hardest context.** Plan the meal before a long shift, the restaurant order, the weekend breakfast, or the snack that keeps you from getting home ravenous.
6. **Week 8: review the trend.** Keep changes that survived busy days and social meals. Drop rules that created guilt without moving the trend.

Calorie tracking is optional. If you use it, treat the number as an estimate and a short-term learning tool. Portion changes, repeatable meals, and regular weighing work without logging every ingredient. Build maintenance in from day one: choose behaviors you'd keep after your weight settles.

## How to know it is working

Use a 7-day weight average or compare the same day each week. Daily shifts mostly reflect water, sodium, carbohydrate storage, food in the gut, hormones, and training, not instant fat gain or loss. Look for a trend across at least three to four weeks.

There is no single right weekly rate. A slow, gradual trend is easier for many people to keep, and the right pace depends on your starting point, health, and context. Larger early drops are often water. Track strength, energy, hunger, sleep, mood, and whether the plan survives weekends. A falling scale with collapsing performance, constant preoccupation, or binge eating is a bad trade.

Plateaus are normal: a smaller body uses less energy, and hunger, spontaneous movement, and adherence shift over time. A maintenance period is not failure. It can settle routines, improve training, and show whether the result is livable.

## If you get stuck

Don't call two noisy weeks a plateau. Wait for at least three fairly consistent weeks, then look at the pattern without blame. Usual culprits: bigger weekend portions, liquid calories, less daily movement, rebound hunger from the plan, or changed measurement conditions.

Adjust one lever modestly, such as a smaller restaurant portion, a planned afternoon snack, an extra walk, or swapping a drink. Reassess after two to three weeks instead of correcting daily.

If strength, mood, sleep, libido, or menstrual function is worsening, the deficit may be too large. Hold or raise intake rather than pushing harder. If hunger is extreme on a modest plan, or weight doesn't respond over a longer period, review medications, sleep, health conditions, and treatment options with a qualified clinician. Prescription weight-loss medicines and bariatric procedures work for some people but need individual assessment, monitoring, and a plan for nutrition and lean mass.

## A quick note

Don't pursue intentional weight loss during pregnancy, with untreated eating-disorder symptoms, or when weight is falling without trying. Get individualized care for diabetes medications, prescription weight-loss drugs, bariatric surgery, major organ disease, adolescence, underweight, or persistent symptoms. Fainting, chest pain, severe weakness, repeated vomiting, purging, or rapid unexplained loss needs prompt care.

## Sources

- [NIDDK: Eating and physical activity to lose or maintain weight](https://www.niddk.nih.gov/health-information/weight-management/adult-overweight-obesity/eating-physical-activity)
- [Dietary Guidelines for Americans, 2025–2030](https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines)
- [Physical Activity Guidelines for Americans, second edition](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf)
- [Review of dietary protein in weight loss and maintenance](https://pubmed.ncbi.nlm.nih.gov/19400750/)
